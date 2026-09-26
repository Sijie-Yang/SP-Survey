// survey-core ships in lockstep with survey-react-ui, which the repo depends on directly.
const VERSION_SOURCES = {
  'survey-core': 'survey-react-ui',
};

const resolveRepoVersion = (name, repoPackage) => {
  const repoDeps = { ...(repoPackage.devDependencies || {}), ...(repoPackage.dependencies || {}) };
  return repoDeps[name] || repoDeps[VERSION_SOURCES[name]] || null;
};

const pinVersions = (deps, repoPackage, missing) => Object.keys(deps || {}).reduce((pinned, name) => {
  const version = resolveRepoVersion(name, repoPackage);
  if (!version) missing.push(name);
  pinned[name] = version;
  return pinned;
}, {});

const alignDeploymentPackageJson = (generatedPackageJson, repoPackage) => {
  const generated = JSON.parse(generatedPackageJson);
  const missing = [];
  generated.dependencies = pinVersions(generated.dependencies, repoPackage, missing);
  generated.devDependencies = pinVersions(generated.devDependencies, repoPackage, missing);
  if (missing.length > 0) {
    throw new Error(`Participant dependencies missing from the repo package.json: ${missing.join(', ')}`);
  }
  return JSON.stringify(generated, null, 2);
};

module.exports = {
  alignDeploymentPackageJson,
  resolveRepoVersion,
};
