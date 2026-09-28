import fs from 'fs';
import path from 'path';
import { alignDeploymentPackageJson } from '../server/deploymentPackage';
import { generateDeploymentFiles, PARTICIPANT_DEPENDENCIES } from './deploymentManager';

const repoRoot = path.resolve(__dirname, '..', '..');
const repoPackage = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const srcRoot = path.join(repoRoot, 'src');
const EXCLUDED_FROM_DEPLOYMENT = ['AdminApp.js', 'components/admin'];

const generate = () => generateDeploymentFiles({ projectName: 'probe', timestamp: 'now', config: { pages: [] } });

const importSpecifiers = (source) => {
  const specifiers = [];
  const pattern = /(?:import\s[^'"]*?from\s*|import\s*\(\s*|import\s+|require\(\s*)['"]([^'"]+)['"]/g;
  let match;
  while ((match = pattern.exec(source))) specifiers.push(match[1]);
  return specifiers;
};

const resolveLocal = (fromDir, specifier, generatedFiles) => {
  const base = path.resolve(fromDir, specifier);
  const candidates = [base, `${base}.js`, `${base}.mjs`, `${base}.jsx`, path.join(base, 'index.js')];
  return candidates.find((candidate) => {
    const generatedKey = `src/${path.relative(srcRoot, candidate).split(path.sep).join('/')}`;
    return generatedFiles[generatedKey] !== undefined
      || (fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  });
};

const packageName = (specifier) => (specifier.startsWith('@')
  ? specifier.split('/').slice(0, 2).join('/')
  : specifier.split('/')[0]);

// Walks the participant bundle's import graph as it exists in the generated folder.
const collectParticipantImports = (generatedFiles) => {
  const packages = new Set();
  const excludedReached = [];
  const seen = new Set();
  const visit = (relativePath, source) => {
    if (seen.has(relativePath)) return;
    seen.add(relativePath);
    const dir = path.dirname(path.join(srcRoot, relativePath));
    importSpecifiers(source).forEach((specifier) => {
      if (/\.(css|svg|png|jpe?g|json)$/i.test(specifier)) return;
      if (!specifier.startsWith('.')) {
        packages.add(packageName(specifier));
        return;
      }
      const resolved = resolveLocal(dir, specifier, generatedFiles);
      if (!resolved) throw new Error(`Unresolved import ${specifier} from ${relativePath}`);
      const childRelative = path.relative(srcRoot, resolved).split(path.sep).join('/');
      if (EXCLUDED_FROM_DEPLOYMENT.some((excluded) => childRelative.includes(excluded))) {
        excludedReached.push(childRelative);
        return;
      }
      const generatedChild = generatedFiles[`src/${childRelative}`];
      visit(childRelative, generatedChild ?? fs.readFileSync(resolved, 'utf8'));
    });
  };
  visit('index.js', fs.readFileSync(path.join(srcRoot, 'index.js'), 'utf8'));
  return { packages, excludedReached };
};

describe('generated participant package.json', () => {
  test('every participant dependency is pinned to the repo package.json version', async () => {
    const files = await generate();
    const aligned = JSON.parse(alignDeploymentPackageJson(files['package.json'], repoPackage));

    expect(Object.keys(aligned.dependencies).sort()).toEqual([...PARTICIPANT_DEPENDENCIES].sort());
    Object.entries(aligned.dependencies).forEach(([name, version]) => {
      const expected = name === 'survey-core'
        ? repoPackage.dependencies['survey-react-ui']
        : repoPackage.dependencies[name];
      expect(version).toBe(expected);
    });
    expect(aligned.devDependencies['cross-env']).toBe(repoPackage.devDependencies['cross-env']);
    expect(aligned.eslintConfig).toEqual({ root: true, extends: ['react-app'] });
  });

  test('unknown participant dependencies fail instead of shipping a guessed version', () => {
    const generated = JSON.stringify({ dependencies: { 'left-pad': '*' }, devDependencies: {} });
    expect(() => alignDeploymentPackageJson(generated, repoPackage)).toThrow('left-pad');
  });

  test('every package the participant bundle imports is declared', async () => {
    const files = await generate();
    const { packages, excludedReached } = collectParticipantImports(files);
    const declared = new Set(PARTICIPANT_DEPENDENCIES);

    expect(excludedReached).toEqual([]);
    expect([...packages].filter((name) => !declared.has(name)).sort()).toEqual([]);
  });
});
