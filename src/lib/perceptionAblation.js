/**
 * Browser-side multi-model ablation for Image × Perception.
 * VIF screen → OLS / Ridge / Lasso / RF / Gradient Boosting / MLP.
 * Cooperative cancel via AbortSignal + onProgress yields.
 */
import { perceptionFeatureValue, featureKeyMatchesModelFilter } from './imagePerceptionJoin';

export const ABLATION_MODELS = [
  { id: 'ols', label: 'OLS' },
  { id: 'ridge', label: 'Ridge' },
  { id: 'lasso', label: 'Lasso' },
  { id: 'elasticnet', label: 'Elastic Net' },
  { id: 'rf', label: 'Random Forest' },
  { id: 'gbm', label: 'Gradient Boosting' },
  { id: 'mlp', label: 'Neural Net (MLP)' },
];

const META_SKIP = new Set([
  'media_id', 'name', 'url', 'mean_score', 'n_ratings', 'question_name',
  'attribute_id', 'score_kind',
  'l0_status', 'seg_status', 'sam_status', 'seg_vocab',
]);

function assertNotAborted(signal) {
  if (signal?.aborted) {
    // Plain Error only — Safari throws if anything assigns to DOMException.name/message.
    throw new Error('Aborted');
  }
}

export function isAbortError(err) {
  return err?.message === 'Aborted' || err?.name === 'AbortError';
}

async function yieldToUi(signal) {
  assertNotAborted(signal);
  await new Promise((r) => setTimeout(r, 0));
  assertNotAborted(signal);
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mean(xs) {
  if (!xs.length) return 0;
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}

function variance(xs, m = mean(xs)) {
  if (xs.length < 2) return 0;
  let s = 0;
  for (const v of xs) s += (v - m) ** 2;
  return s / xs.length;
}

function std(xs, m = mean(xs)) {
  return Math.sqrt(variance(xs, m)) || 1e-12;
}

function r2Score(yTrue, yPred) {
  const m = mean(yTrue);
  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < yTrue.length; i += 1) {
    ssTot += (yTrue[i] - m) ** 2;
    ssRes += (yTrue[i] - yPred[i]) ** 2;
  }
  if (ssTot < 1e-18) return 0;
  return 1 - ssRes / ssTot;
}

function rmse(yTrue, yPred) {
  let s = 0;
  for (let i = 0; i < yTrue.length; i += 1) s += (yTrue[i] - yPred[i]) ** 2;
  return Math.sqrt(s / Math.max(yTrue.length, 1));
}

function mae(yTrue, yPred) {
  let s = 0;
  for (let i = 0; i < yTrue.length; i += 1) s += Math.abs(yTrue[i] - yPred[i]);
  return s / Math.max(yTrue.length, 1);
}

function metrics(yTrue, yPred) {
  return {
    r2: r2Score(yTrue, yPred),
    rmse: rmse(yTrue, yPred),
    mae: mae(yTrue, yPred),
  };
}

/** Heuristic fit diagnosis for UI chips. */
export function diagnoseFit(train, test) {
  const tr = train?.r2;
  const te = test?.r2;
  if (!Number.isFinite(tr) || !Number.isFinite(te)) return null;
  if (tr > 0.35 && tr - te > 0.25) return 'overfit';
  if (tr < 0.1 && te < 0.1) return 'weak_fit';
  if (te < 0 && tr < 0.15) return 'weak_fit';
  return 'ok';
}

function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

function meanStdMetrics(list) {
  const keys = ['r2', 'rmse', 'mae'];
  const out = {};
  keys.forEach((k) => {
    const vals = list.map((m) => m?.[k]).filter((v) => Number.isFinite(v));
    if (!vals.length) {
      out[k] = NaN;
      out[`${k}_std`] = NaN;
      return;
    }
    const m = mean(vals);
    out[k] = m;
    out[`${k}_std`] = vals.length > 1 ? Math.sqrt(variance(vals, m)) : 0;
  });
  return out;
}

/** Gaussian elimination solve Ax = b. A is n×n (mutated copy). */
function solveLinear(Ain, bin, pivotEps = 1e-10) {
  const n = bin.length;
  const A = Ain.map((row, i) => [...row, bin[i]]);
  for (let col = 0; col < n; col += 1) {
    let piv = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    }
    if (Math.abs(A[piv][col]) < pivotEps) return null;
    if (piv !== col) {
      const tmp = A[col];
      A[col] = A[piv];
      A[piv] = tmp;
    }
    const div = A[col][col];
    for (let c = col; c <= n; c += 1) A[col][c] /= div;
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const f = A[r][col];
      if (!f) continue;
      for (let c = col; c <= n; c += 1) A[r][c] -= f * A[col][c];
    }
  }
  return A.map((row) => row[n]);
}

function matVec(X, beta) {
  return X.map((row) => {
    let s = 0;
    for (let j = 0; j < beta.length; j += 1) s += row[j] * beta[j];
    return s;
  });
}

function transpose(X) {
  const n = X.length;
  const p = X[0]?.length || 0;
  const T = Array.from({ length: p }, () => Array(n).fill(0));
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < p; j += 1) T[j][i] = X[i][j];
  }
  return T;
}

function matMul(A, B) {
  const n = A.length;
  const m = B[0]?.length || 0;
  const k = B.length;
  const C = Array.from({ length: n }, () => Array(m).fill(0));
  for (let i = 0; i < n; i += 1) {
    for (let t = 0; t < k; t += 1) {
      const a = A[i][t];
      if (!a) continue;
      for (let j = 0; j < m; j += 1) C[i][j] += a * B[t][j];
    }
  }
  return C;
}

/** Drop near-constant columns (cause singular XtX). */
function dropConstantColumns(X, featureNames, eps = 1e-10) {
  if (!X.length) return { X, featureNames, dropped: [] };
  const p = X[0].length;
  const keep = [];
  const dropped = [];
  for (let j = 0; j < p; j += 1) {
    const col = X.map((r) => r[j]);
    if (std(col) <= eps) dropped.push(featureNames[j]);
    else keep.push(j);
  }
  if (keep.length === p) return { X, featureNames, dropped: [] };
  return {
    X: X.map((row) => keep.map((j) => row[j])),
    featureNames: keep.map((j) => featureNames[j]),
    dropped,
  };
}

/**
 * OLS / Ridge closed form. X includes intercept column.
 * Falls back to increasing ridge when XtX is singular (collinearity / p≈n).
 */
function fitRidge(X, y, lambda = 0) {
  if (!X?.length || !X[0]?.length) return null;
  const Xt = transpose(X);
  const XtX = matMul(Xt, X);
  const p = XtX.length;
  const Xty = Xt.map((row) => {
    let s = 0;
    for (let i = 0; i < y.length; i += 1) s += row[i] * y[i];
    return s;
  });

  const trySolve = (lam) => {
    // Always allocate a fresh matrix — never mutate XtX (may be shared / frozen).
    const reg = XtX.map((row, i) => row.map((v, j) => v + (i === j && i !== 0 ? lam : 0)));
    return solveLinear(reg, Xty);
  };

  // Always start with a tiny stabilizer for OLS (lambda=0) to avoid singular pivots.
  const n = X.length;
  const floor = p >= n ? 1e-2 : 1e-8;
  const bumps = [
    Math.max(lambda, floor),
    Math.max(lambda, 1e-6),
    Math.max(lambda, 1e-4),
    Math.max(lambda, 1e-2),
    Math.max(lambda, 0.1),
    Math.max(lambda, 1),
    Math.max(lambda, 10),
  ];
  const tried = new Set();
  for (const lam of bumps) {
    const key = String(lam);
    if (tried.has(key)) continue;
    tried.add(key);
    const beta = trySolve(lam);
    if (beta) return beta;
  }
  return null;
}

function fitLasso(X, y, {
  alpha = 0.01,
  l1Ratio = 1,
  maxIter = 400,
  tol = 1e-5,
} = {}) {
  const n = X.length;
  const p = X[0].length;
  const beta = Array(p).fill(0);
  beta[0] = mean(y);
  const soft = (z, t) => {
    if (z > t) return z - t;
    if (z < -t) return z + t;
    return 0;
  };
  for (let iter = 0; iter < maxIter; iter += 1) {
    let maxDelta = 0;
    for (let j = 0; j < p; j += 1) {
      let residDot = 0;
      let zj = 0;
      for (let i = 0; i < n; i += 1) {
        let pred = 0;
        for (let k = 0; k < p; k += 1) {
          if (k === j) continue;
          pred += X[i][k] * beta[k];
        }
        const r = y[i] - pred;
        residDot += X[i][j] * r;
        zj += X[i][j] * X[i][j];
      }
      if (zj < 1e-18) continue;
      const rho = residDot / n;
      const zjN = zj / n;
      let next;
      if (j === 0) {
        next = rho / zjN;
      } else {
        const l1 = alpha * l1Ratio;
        const l2 = alpha * (1 - l1Ratio);
        next = soft(rho, l1) / (zjN + l2);
      }
      maxDelta = Math.max(maxDelta, Math.abs(next - beta[j]));
      beta[j] = next;
    }
    if (maxDelta < tol) break;
  }
  return beta;
}

function withIntercept(X) {
  return X.map((row) => [1, ...row]);
}

function standardizeColumns(X) {
  const n = X.length;
  const p = X[0]?.length || 0;
  const means = Array(p).fill(0);
  const sds = Array(p).fill(1);
  for (let j = 0; j < p; j += 1) {
    const col = X.map((r) => r[j]);
    means[j] = mean(col);
    sds[j] = std(col, means[j]);
  }
  const Xs = X.map((row) => row.map((v, j) => (v - means[j]) / sds[j]));
  return { Xs, means, sds };
}

/** VIF for each feature (no intercept). Drop until all VIF <= maxVif. */
export async function screenByVif(X, featureNames, maxVif = 10, minFeatures = 2, signal = null) {
  let names = [...featureNames];
  let cols = X.map((row) => [...row]);
  const dropped = [];
  while (names.length > minFeatures) {
    assertNotAborted(signal);
    const { Xs } = standardizeColumns(cols);
    const p = names.length;
    const vifs = [];
    for (let j = 0; j < p; j += 1) {
      const yj = Xs.map((r) => r[j]);
      const Xj = Xs.map((r) => r.filter((_, k) => k !== j));
      if (Xj[0].length === 0) {
        vifs.push({ j, name: names[j], vif: 1 });
        continue;
      }
      const Xi = withIntercept(Xj);
      const beta = fitRidge(Xi, yj, 1e-8);
      if (!beta) {
        vifs.push({ j, name: names[j], vif: Infinity });
        continue;
      }
      const pred = matVec(Xi, beta);
      const r2 = r2Score(yj, pred);
      const vif = r2 >= 0.999999 ? Infinity : 1 / (1 - r2);
      vifs.push({ j, name: names[j], vif });
    }
    vifs.sort((a, b) => b.vif - a.vif);
    const worst = vifs[0];
    if (!(worst.vif > maxVif)) {
      return {
        featureNames: names,
        X: cols,
        vifs: vifs.map((v) => ({ feature: v.name, vif: Number.isFinite(v.vif) ? v.vif : null })),
        dropped,
      };
    }
    dropped.push({ feature: worst.name, vif: Number.isFinite(worst.vif) ? worst.vif : null });
    names = names.filter((_, i) => i !== worst.j);
    cols = cols.map((row) => row.filter((_, i) => i !== worst.j));
    await yieldToUi(signal);
  }
  const { Xs } = standardizeColumns(cols);
  const finalVifs = names.map((name, j) => {
    const yj = Xs.map((r) => r[j]);
    const Xj = Xs.map((r) => r.filter((_, k) => k !== j));
    if (!Xj[0]?.length) return { feature: name, vif: 1 };
    const Xi = withIntercept(Xj);
    const beta = fitRidge(Xi, yj, 1e-8);
    if (!beta) return { feature: name, vif: null };
    const r2 = r2Score(yj, matVec(Xi, beta));
    return { feature: name, vif: r2 >= 0.999999 ? null : 1 / (1 - r2) };
  });
  return { featureNames: names, X: cols, vifs: finalVifs, dropped };
}

function trainTestSplit(X, y, testFrac, rng) {
  const idx = X.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const t = idx[i];
    idx[i] = idx[j];
    idx[j] = t;
  }
  const nTest = Math.max(1, Math.floor(X.length * testFrac));
  const nTrain = X.length - nTest;
  if (nTrain < 5) {
    return {
      Xtrain: X,
      ytrain: y,
      Xtest: X,
      ytest: y,
      trainIdx: idx,
      testIdx: idx,
    };
  }
  const testIdx = idx.slice(0, nTest);
  const trainIdx = idx.slice(nTest);
  return {
    Xtrain: trainIdx.map((i) => X[i]),
    ytrain: trainIdx.map((i) => y[i]),
    Xtest: testIdx.map((i) => X[i]),
    ytest: testIdx.map((i) => y[i]),
    trainIdx,
    testIdx,
  };
}

function importanceFromAbsBeta(names, betaWithIntercept) {
  const coeffs = names.map((name, i) => ({
    feature: name,
    weight: betaWithIntercept[i + 1] || 0,
  }));
  const maxAbs = Math.max(...coeffs.map((c) => Math.abs(c.weight)), 1e-12);
  return coeffs
    .map((c) => ({ ...c, importance: Math.abs(c.weight) / maxAbs }))
    .sort((a, b) => b.importance - a.importance);
}

/* ---------- trees / RF / GBM ---------- */

function buildTree(X, y, rng, {
  maxDepth = 5,
  minLeaf = 5,
  maxFeatures = null,
} = {}, depth = 0) {
  const n = y.length;
  const m = mean(y);
  if (depth >= maxDepth || n <= minLeaf * 2) {
    return { type: 'leaf', value: m };
  }
  const p = X[0].length;
  const nFeat = maxFeatures ? Math.min(p, maxFeatures) : p;
  const feats = Array.from({ length: p }, (_, i) => i);
  for (let i = feats.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const t = feats[i];
    feats[i] = feats[j];
    feats[j] = t;
  }
  const candidates = feats.slice(0, nFeat);
  let best = null;
  for (const j of candidates) {
    const vals = X.map((r) => r[j]);
    const uniq = [...new Set(vals)].sort((a, b) => a - b);
    if (uniq.length < 2) continue;
    const step = Math.max(1, Math.floor(uniq.length / 12));
    for (let t = step; t < uniq.length; t += step) {
      const thr = (uniq[t - 1] + uniq[t]) / 2;
      const leftY = [];
      const rightY = [];
      for (let i = 0; i < n; i += 1) {
        if (X[i][j] <= thr) leftY.push(y[i]);
        else rightY.push(y[i]);
      }
      if (leftY.length < minLeaf || rightY.length < minLeaf) continue;
      const varTot = variance(y);
      const gain = varTot - (leftY.length / n) * variance(leftY) - (rightY.length / n) * variance(rightY);
      if (!best || gain > best.gain) best = { j, thr, gain };
    }
  }
  if (!best || best.gain <= 1e-12) return { type: 'leaf', value: m };
  const leftX = [];
  const leftY = [];
  const rightX = [];
  const rightY = [];
  for (let i = 0; i < n; i += 1) {
    if (X[i][best.j] <= best.thr) {
      leftX.push(X[i]);
      leftY.push(y[i]);
    } else {
      rightX.push(X[i]);
      rightY.push(y[i]);
    }
  }
  return {
    type: 'split',
    feature: best.j,
    threshold: best.thr,
    left: buildTree(leftX, leftY, rng, { maxDepth, minLeaf, maxFeatures }, depth + 1),
    right: buildTree(rightX, rightY, rng, { maxDepth, minLeaf, maxFeatures }, depth + 1),
  };
}

function predictTree(tree, row) {
  let node = tree;
  while (node && node.type === 'split') {
    node = row[node.feature] <= node.threshold ? node.left : node.right;
  }
  return node?.value ?? 0;
}

function accumulateTreeImportance(tree, counts) {
  if (!tree || tree.type === 'leaf') return;
  const j = tree.feature;
  counts[j] = (counts[j] || 0) + 1;
  accumulateTreeImportance(tree.left, counts);
  accumulateTreeImportance(tree.right, counts);
}

async function fitRandomForest(X, y, rng, signal, onProgress, {
  nTrees = 40,
  maxDepth = 6,
  minLeaf = 4,
} = {}) {
  const p = X[0].length;
  const maxFeatures = Math.max(1, Math.floor(Math.sqrt(p)));
  const trees = [];
  const counts = Object.create(null);
  for (let t = 0; t < nTrees; t += 1) {
    assertNotAborted(signal);
    const bagX = [];
    const bagY = [];
    for (let i = 0; i < X.length; i += 1) {
      const k = Math.floor(rng() * X.length);
      bagX.push(X[k]);
      bagY.push(y[k]);
    }
    const tree = buildTree(bagX, bagY, rng, { maxDepth, minLeaf, maxFeatures });
    trees.push(tree);
    accumulateTreeImportance(tree, counts);
    onProgress?.({ model: 'rf', done: t + 1, total: nTrees });
    if (t % 2 === 1) await yieldToUi(signal);
  }
  const predict = (rows) => rows.map((row) => {
    let s = 0;
    for (const tree of trees) s += predictTree(tree, row);
    return s / trees.length;
  });
  const imp = Array.from({ length: p }, (_, i) => counts[i] || 0);
  const maxImp = Math.max(...imp, 1e-12);
  return {
    predict,
    importance: imp.map((v, i) => ({ featureIndex: i, importance: v / maxImp })),
  };
}

async function fitGbm(X, y, rng, signal, onProgress, {
  nEstimators = 60,
  learningRate = 0.08,
  maxDepth = 3,
  minLeaf = 5,
} = {}) {
  const p = X[0].length;
  const F0 = mean(y);
  const trees = [];
  const counts = Object.create(null);
  let residual = y.map((v) => v - F0);
  for (let t = 0; t < nEstimators; t += 1) {
    assertNotAborted(signal);
    const tree = buildTree(X, residual, rng, {
      maxDepth,
      minLeaf,
      maxFeatures: Math.max(1, Math.floor(Math.sqrt(p))),
    });
    trees.push(tree);
    accumulateTreeImportance(tree, counts);
    residual = residual.map((r, i) => r - learningRate * predictTree(tree, X[i]));
    onProgress?.({ model: 'gbm', done: t + 1, total: nEstimators });
    if (t % 2 === 1) await yieldToUi(signal);
  }
  const predict = (rows) => rows.map((row) => {
    let s = F0;
    for (const tree of trees) s += learningRate * predictTree(tree, row);
    return s;
  });
  const imp = Array.from({ length: p }, (_, i) => counts[i] || 0);
  const maxImp = Math.max(...imp, 1e-12);
  return {
    predict,
    importance: imp.map((v, i) => ({ featureIndex: i, importance: v / maxImp })),
  };
}

/* ---------- tiny MLP (standardized y, minibatch, early stop) ---------- */

function relu(x) { return x > 0 ? x : 0; }
function drelu(x) { return x > 0 ? 1 : 0; }

function mlpForward(x, W1, b1, W2, b2, hidden) {
  const h = Array(hidden);
  const hPre = Array(hidden);
  for (let j = 0; j < hidden; j += 1) {
    let s = b1[j];
    for (let k = 0; k < x.length; k += 1) s += W1[j][k] * x[k];
    hPre[j] = s;
    h[j] = relu(s);
  }
  let pred = b2;
  for (let j = 0; j < hidden; j += 1) pred += W2[j] * h[j];
  return { pred, h, hPre };
}

function mlpPredictScaled(rows, W1, b1, W2, b2, hidden, yMean, ySd) {
  return rows.map((x) => {
    const { pred } = mlpForward(x, W1, b1, W2, b2, hidden);
    return pred * ySd + yMean;
  });
}

function mlpValMse(X, yScaled, W1, b1, W2, b2, hidden) {
  if (!X.length) return Infinity;
  let s = 0;
  for (let i = 0; i < X.length; i += 1) {
    const { pred } = mlpForward(X[i], W1, b1, W2, b2, hidden);
    const err = pred - yScaled[i];
    s += err * err;
  }
  return s / X.length;
}

function cloneMlpWeights(W1, b1, W2, b2) {
  return {
    W1: W1.map((row) => [...row]),
    b1: [...b1],
    W2: [...W2],
    b2,
  };
}

async function fitMlp(X, y, rng, signal, onProgress, {
  hidden = 16,
  epochs = 200,
  lr = 0.01,
  batchSize = 16,
  valFraction = 0.2,
  patience = 20,
  momentum = 0.9,
} = {}) {
  const n = X.length;
  const p = X[0].length;
  if (n < 4) {
    const m = mean(y);
    return {
      predict: (rows) => rows.map(() => m),
      importance: Array.from({ length: p }, (_, i) => ({ featureIndex: i, importance: 0 })),
      note: 'Too few rows; used mean.',
      epochsRun: 0,
    };
  }

  // Hold out validation from train for early stopping
  const idx = shuffleInPlace(X.map((_, i) => i), rng);
  let nVal = Math.max(1, Math.floor(n * valFraction));
  if (n - nVal < 4) nVal = Math.max(1, Math.floor(n * 0.15));
  if (n - nVal < 3) nVal = 0;
  const valIdx = nVal > 0 ? idx.slice(0, nVal) : [];
  const fitIdx = nVal > 0 ? idx.slice(nVal) : idx;
  const Xfit = fitIdx.map((i) => X[i]);
  const yfit = fitIdx.map((i) => y[i]);
  const Xval = valIdx.map((i) => X[i]);
  const yval = valIdx.map((i) => y[i]);

  const yMean = mean(yfit);
  const ySd = std(yfit, yMean) || 1;
  const yfitS = yfit.map((v) => (v - yMean) / ySd);
  const yvalS = yval.map((v) => (v - yMean) / ySd);

  const W1 = Array.from({ length: hidden }, () => Array.from({ length: p }, () => (rng() * 2 - 1) * 0.15));
  const b1 = Array(hidden).fill(0);
  const W2 = Array.from({ length: hidden }, () => (rng() * 2 - 1) * 0.15);
  let b2 = 0;

  // Momentum buffers
  const vW1 = W1.map((row) => row.map(() => 0));
  const vb1 = Array(hidden).fill(0);
  const vW2 = Array(hidden).fill(0);
  let vb2 = 0;

  let best = cloneMlpWeights(W1, b1, W2, b2);
  let bestVal = Infinity;
  let wait = 0;
  let epochsRun = 0;
  const bs = Math.max(1, Math.min(batchSize, Xfit.length));

  for (let ep = 0; ep < epochs; ep += 1) {
    assertNotAborted(signal);
    epochsRun = ep + 1;
    const order = shuffleInPlace(Xfit.map((_, i) => i), rng);
    let loss = 0;

    for (let start = 0; start < order.length; start += bs) {
      const batch = order.slice(start, start + bs);
      // Accumulators for batch gradients
      const gW1 = W1.map((row) => row.map(() => 0));
      const gb1 = Array(hidden).fill(0);
      const gW2 = Array(hidden).fill(0);
      let gb2 = 0;

      for (const i of batch) {
        const x = Xfit[i];
        const { pred, h, hPre } = mlpForward(x, W1, b1, W2, b2, hidden);
        const err = pred - yfitS[i];
        loss += err * err;
        gb2 += err;
        for (let j = 0; j < hidden; j += 1) {
          gW2[j] += err * h[j];
          const dh = err * W2[j] * drelu(hPre[j]);
          gb1[j] += dh;
          for (let k = 0; k < p; k += 1) gW1[j][k] += dh * x[k];
        }
      }

      const inv = 1 / batch.length;
      vb2 = momentum * vb2 + lr * gb2 * inv;
      b2 -= vb2;
      for (let j = 0; j < hidden; j += 1) {
        vW2[j] = momentum * vW2[j] + lr * gW2[j] * inv;
        W2[j] -= vW2[j];
        vb1[j] = momentum * vb1[j] + lr * gb1[j] * inv;
        b1[j] -= vb1[j];
        for (let k = 0; k < p; k += 1) {
          vW1[j][k] = momentum * vW1[j][k] + lr * gW1[j][k] * inv;
          W1[j][k] -= vW1[j][k];
        }
      }
    }

    const valMse = Xval.length
      ? mlpValMse(Xval, yvalS, W1, b1, W2, b2, hidden)
      : loss / Math.max(Xfit.length, 1);

    if (valMse + 1e-9 < bestVal) {
      bestVal = valMse;
      best = cloneMlpWeights(W1, b1, W2, b2);
      wait = 0;
    } else {
      wait += 1;
    }

    onProgress?.({
      model: 'mlp',
      done: ep + 1,
      total: epochs,
      loss: loss / Math.max(Xfit.length, 1),
      valMse,
      bestVal,
    });

    if (ep % 4 === 3) await yieldToUi(signal);
    if (wait >= patience) break;
  }

  // Restore best
  const { W1: fW1, b1: fb1, W2: fW2, b2: fb2 } = best;

  const predict = (rows) => mlpPredictScaled(rows, fW1, fb1, fW2, fb2, hidden, yMean, ySd);

  const imp = Array(p).fill(0);
  for (let k = 0; k < p; k += 1) {
    let s = 0;
    for (let j = 0; j < hidden; j += 1) s += Math.abs(fW2[j]) * Math.abs(fW1[j][k]);
    imp[k] = s;
  }
  const maxImp = Math.max(...imp, 1e-12);
  return {
    predict,
    importance: imp.map((v, i) => ({ featureIndex: i, importance: v / maxImp })),
    note: `Stopped @ epoch ${epochsRun}`,
    epochsRun,
  };
}

/**
 * Collect numeric feature matrix from perception rows.
 * @param {object} [opts]
 * @param {boolean} [opts.impute=true] — fill missing feature cells with column median
 */
export function buildAblationMatrix(rows, modelFilter = 'all', { impute = true } = {}) {
  const scored = (rows || []).filter((r) => r.mean_score != null && r.n_ratings > 0);
  const keySet = new Set();
  scored.forEach((r) => {
    Object.keys(r).forEach((k) => {
      if (META_SKIP.has(k)) return;
      if (!featureKeyMatchesModelFilter(k, modelFilter)) return;
      if (Number.isFinite(perceptionFeatureValue(r, k))) keySet.add(k);
    });
  });
  let featureNames = [...keySet].sort((a, b) => a.localeCompare(b));

  // Column medians from finite values (for impute / drop empty cols)
  const colVals = featureNames.map((k) => (
    scored.map((r) => perceptionFeatureValue(r, k)).filter((v) => Number.isFinite(v))
  ));
  const medians = colVals.map((vals) => (vals.length ? median(vals) : null));
  // Drop columns with no finite values at all
  const keepCol = medians.map((m) => m != null && Number.isFinite(m));
  featureNames = featureNames.filter((_, j) => keepCol[j]);
  const colMedians = medians.filter((_, j) => keepCol[j]);

  const Xraw = [];
  const y = [];
  const keepIds = [];
  let imputedCells = 0;
  let droppedIncomplete = 0;

  for (const r of scored) {
    const row = [];
    let ok = true;
    let rowImputed = 0;
    for (let j = 0; j < featureNames.length; j += 1) {
      let v = perceptionFeatureValue(r, featureNames[j]);
      if (!Number.isFinite(v)) {
        if (impute && Number.isFinite(colMedians[j])) {
          v = colMedians[j];
          rowImputed += 1;
        } else {
          ok = false;
          break;
        }
      }
      row.push(v);
    }
    if (!ok) {
      droppedIncomplete += 1;
      continue;
    }
    imputedCells += rowImputed;
    Xraw.push(row);
    y.push(r.mean_score);
    keepIds.push(r.media_id);
  }

  return {
    featureNames,
    X: Xraw,
    y,
    mediaIds: keepIds,
    n: y.length,
    imputedCells,
    droppedIncomplete,
    impute,
  };
}

async function trainOneModel(modelId, Xtrain, ytrain, Xtest, ytest, names, rng, signal, report, basePct, totalSteps) {
  let trainPred;
  let testPred;
  let importance = [];
  let note = null;
  let failed = false;

  if (modelId === 'ols' || modelId === 'ridge') {
    const lambda = modelId === 'ridge' ? 1.0 : 0;
    const beta = fitRidge(withIntercept(Xtrain), ytrain, lambda);
    if (!beta) {
      return {
        model: modelId,
        label: ABLATION_MODELS.find((m) => m.id === modelId)?.label || modelId,
        train: { r2: NaN, rmse: NaN, mae: NaN },
        test: { r2: NaN, rmse: NaN, mae: NaN },
        importance: [],
        note: 'Solve failed (singular design).',
        failed: true,
        diagnosis: null,
      };
    }
    trainPred = matVec(withIntercept(Xtrain), beta);
    testPred = matVec(withIntercept(Xtest), beta);
    importance = importanceFromAbsBeta(names, beta);
    if (modelId === 'ols' && Xtrain[0].length + 1 >= ytrain.length) {
      note = 'Used numerical ridge stabilizer (features ≥ train rows).';
    }
  } else if (modelId === 'lasso') {
    const beta = fitLasso(withIntercept(Xtrain), ytrain, { alpha: 0.02, l1Ratio: 1 });
    trainPred = matVec(withIntercept(Xtrain), beta);
    testPred = matVec(withIntercept(Xtest), beta);
    importance = importanceFromAbsBeta(names, beta);
  } else if (modelId === 'elasticnet') {
    const beta = fitLasso(withIntercept(Xtrain), ytrain, { alpha: 0.02, l1Ratio: 0.5 });
    trainPred = matVec(withIntercept(Xtrain), beta);
    testPred = matVec(withIntercept(Xtest), beta);
    importance = importanceFromAbsBeta(names, beta);
  } else if (modelId === 'rf') {
    const model = await fitRandomForest(Xtrain, ytrain, rng, signal, (p) => {
      report(`Random Forest ${p.done}/${p.total}`, {
        phase: 'rf',
        pct: basePct + (p.done / p.total) * (80 / totalSteps) * 0.9,
        model: 'rf',
      });
    });
    trainPred = model.predict(Xtrain);
    testPred = model.predict(Xtest);
    importance = model.importance
      .map((d) => ({ feature: names[d.featureIndex], importance: d.importance, weight: d.importance }))
      .sort((a, b) => b.importance - a.importance);
  } else if (modelId === 'gbm') {
    note = 'In-browser GBM';
    const model = await fitGbm(Xtrain, ytrain, rng, signal, (p) => {
      report(`Gradient Boosting ${p.done}/${p.total}`, {
        phase: 'gbm',
        pct: basePct + (p.done / p.total) * (80 / totalSteps) * 0.9,
        model: 'gbm',
      });
    });
    trainPred = model.predict(Xtrain);
    testPred = model.predict(Xtest);
    importance = model.importance
      .map((d) => ({ feature: names[d.featureIndex], importance: d.importance, weight: d.importance }))
      .sort((a, b) => b.importance - a.importance);
  } else if (modelId === 'mlp') {
    const model = await fitMlp(Xtrain, ytrain, rng, signal, (p) => {
      report(`MLP epoch ${p.done}/${p.total}`, {
        phase: 'mlp',
        pct: basePct + (p.done / p.total) * (80 / totalSteps) * 0.9,
        model: 'mlp',
      });
    });
    trainPred = model.predict(Xtrain);
    testPred = model.predict(Xtest);
    importance = model.importance
      .map((d) => ({ feature: names[d.featureIndex], importance: d.importance, weight: d.importance }))
      .sort((a, b) => b.importance - a.importance);
    note = model.note || note;
  } else {
    failed = true;
    note = `Unknown model: ${modelId}`;
  }

  if (failed || !trainPred) {
    return {
      model: modelId,
      label: ABLATION_MODELS.find((m) => m.id === modelId)?.label || modelId,
      train: { r2: NaN, rmse: NaN, mae: NaN },
      test: { r2: NaN, rmse: NaN, mae: NaN },
      importance: [],
      note,
      failed: true,
      diagnosis: null,
    };
  }

  const trainM = metrics(ytrain, trainPred);
  const testM = metrics(ytest, testPred);
  return {
    model: modelId,
    label: ABLATION_MODELS.find((m) => m.id === modelId)?.label || modelId,
    train: trainM,
    test: testM,
    importance: importance.slice(0, 15),
    note,
    failed: false,
    diagnosis: diagnoseFit(trainM, testM),
  };
}

function kFoldIndices(n, k, rng) {
  const idx = shuffleInPlace(Array.from({ length: n }, (_, i) => i), rng);
  const folds = Array.from({ length: k }, () => []);
  idx.forEach((i, t) => { folds[t % k].push(i); });
  return folds;
}

/**
 * Run full ablation pipeline. Cancel with signal.abort().
 * @param {number} [folds=1] — 1 = single holdout; ≥2 = K-fold CV (report mean±std Test R²)
 * @param {boolean} [imputeMissing=true] — median-impute missing feature cells
 */
export async function runPerceptionAblation({
  rows,
  modelFilter = 'all',
  models = ABLATION_MODELS.map((m) => m.id),
  vifMax = 10,
  testFraction = 0.25,
  folds = 1,
  imputeMissing = true,
  seed = 42,
  signal = null,
  onProgress = null,
} = {}) {
  const report = (msg, extra = {}) => {
    onProgress?.({ message: msg, ...extra });
  };

  report('Building feature matrix…', { phase: 'prep', pct: 2 });
  await yieldToUi(signal);
  const built = buildAblationMatrix(rows, modelFilter, { impute: !!imputeMissing });
  built.X = built.X.map((row) => Float64Array.from(row, (v) => +v));
  built.y = Float64Array.from(built.y, (v) => +v);
  if (built.n < 12) {
    throw new Error(
      `Need ≥12 scored images with usable features (have ${built.n}`
      + `${built.droppedIncomplete ? `; dropped ${built.droppedIncomplete} incomplete` : ''}).`,
    );
  }
  if (built.featureNames.length < 2) {
    throw new Error('Need ≥2 numeric features for ablation.');
  }

  report(`VIF screening (${built.featureNames.length} features, max VIF=${vifMax})…`, {
    phase: 'vif',
    pct: 8,
  });
  await yieldToUi(signal);
  const screened = await screenByVif(built.X, built.featureNames, vifMax, 2, signal);
  assertNotAborted(signal);

  const pruned = dropConstantColumns(screened.X, screened.featureNames);
  if (pruned.featureNames.length < 2) {
    throw new Error('Too few non-constant features left after VIF / variance filter.');
  }

  const { Xs, means, sds } = standardizeColumns(pruned.X);
  const rng = mulberry32(seed);
  const selectedModels = models.filter((id) => ABLATION_MODELS.some((m) => m.id === id));
  const names = pruned.featureNames;
  const totalSteps = selectedModels.length;

  const nFolds = Math.max(1, Math.min(10, Math.floor(Number(folds) || 1)));
  const useCv = nFolds >= 2 && built.n >= nFolds * 4;
  const cvFallbackNote = nFolds >= 2 && !useCv
    ? `Requested ${nFolds}-fold CV but n=${built.n} is too small; using single holdout.`
    : null;

  let splitMeta = { nTrain: 0, nTest: 0, foldsUsed: 1 };
  const foldResultsByModel = Object.fromEntries(selectedModels.map((id) => [id, []]));
  const importanceAcc = Object.fromEntries(selectedModels.map((id) => [id, new Map()]));

  if (!useCv) {
    const split = trainTestSplit(Xs, built.y, testFraction, rng);
    splitMeta = {
      nTrain: split.ytrain.length,
      nTest: split.ytest.length,
      foldsUsed: 1,
    };
    let step = 0;
    for (const modelId of selectedModels) {
      assertNotAborted(signal);
      step += 1;
      const basePct = 15 + ((step - 1) / Math.max(totalSteps, 1)) * 80;
      report(`Training ${modelId}…`, { phase: modelId, pct: basePct, model: modelId });
      await yieldToUi(signal);
      try {
        const one = await trainOneModel(
          modelId, split.Xtrain, split.ytrain, split.Xtest, split.ytest,
          names, rng, signal, report, basePct, totalSteps,
        );
        foldResultsByModel[modelId].push(one);
        (one.importance || []).forEach((f) => {
          const m = importanceAcc[modelId];
          m.set(f.feature, (m.get(f.feature) || 0) + (f.importance || 0));
        });
      } catch (modelErr) {
        if (isAbortError(modelErr)) throw modelErr;
        foldResultsByModel[modelId].push({
          model: modelId,
          label: ABLATION_MODELS.find((m) => m.id === modelId)?.label || modelId,
          train: { r2: NaN, rmse: NaN, mae: NaN },
          test: { r2: NaN, rmse: NaN, mae: NaN },
          importance: [],
          note: modelErr?.message || String(modelErr),
          failed: true,
          diagnosis: null,
        });
      }
    }
  } else {
    const foldIdx = kFoldIndices(Xs.length, nFolds, rng);
    splitMeta = {
      nTrain: Math.round(Xs.length * ((nFolds - 1) / nFolds)),
      nTest: Math.round(Xs.length / nFolds),
      foldsUsed: nFolds,
    };
    for (let f = 0; f < nFolds; f += 1) {
      assertNotAborted(signal);
      const testIdx = foldIdx[f];
      const trainIdx = foldIdx.flatMap((arr, i) => (i === f ? [] : arr));
      const Xtrain = trainIdx.map((i) => Xs[i]);
      const ytrain = trainIdx.map((i) => built.y[i]);
      const Xtest = testIdx.map((i) => Xs[i]);
      const ytest = testIdx.map((i) => built.y[i]);
      let step = 0;
      for (const modelId of selectedModels) {
        step += 1;
        const basePct = 15 + ((f * totalSteps + step - 1) / (nFolds * totalSteps)) * 80;
        report(`Fold ${f + 1}/${nFolds} · ${modelId}…`, {
          phase: modelId,
          pct: basePct,
          model: modelId,
          fold: f + 1,
        });
        await yieldToUi(signal);
        try {
          const one = await trainOneModel(
            modelId, Xtrain, ytrain, Xtest, ytest,
            names, rng, signal, report, basePct, totalSteps,
          );
          foldResultsByModel[modelId].push(one);
          (one.importance || []).forEach((feat) => {
            const m = importanceAcc[modelId];
            m.set(feat.feature, (m.get(feat.feature) || 0) + (feat.importance || 0));
          });
        } catch (modelErr) {
          if (isAbortError(modelErr)) throw modelErr;
          foldResultsByModel[modelId].push({
            model: modelId,
            label: ABLATION_MODELS.find((m) => m.id === modelId)?.label || modelId,
            train: { r2: NaN, rmse: NaN, mae: NaN },
            test: { r2: NaN, rmse: NaN, mae: NaN },
            importance: [],
            note: modelErr?.message || String(modelErr),
            failed: true,
            diagnosis: null,
          });
        }
      }
    }
  }

  const results = selectedModels.map((modelId) => {
    const runs = foldResultsByModel[modelId] || [];
    const ok = runs.filter((r) => !r.failed);
    const label = ABLATION_MODELS.find((m) => m.id === modelId)?.label || modelId;
    if (!ok.length) {
      return {
        model: modelId,
        label,
        train: runs[0]?.train || { r2: NaN, rmse: NaN, mae: NaN },
        test: runs[0]?.test || { r2: NaN, rmse: NaN, mae: NaN },
        importance: [],
        note: runs[0]?.note || 'All folds failed.',
        failed: true,
        diagnosis: null,
        folds: runs.length,
      };
    }
    const trainAgg = meanStdMetrics(ok.map((r) => r.train));
    const testAgg = meanStdMetrics(ok.map((r) => r.test));
    const impMap = importanceAcc[modelId];
    const maxImp = Math.max(...impMap.values(), 1e-12);
    const importance = [...impMap.entries()]
      .map(([feature, v]) => ({ feature, importance: v / maxImp, weight: v / maxImp }))
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 15);
    const notes = [...new Set(ok.map((r) => r.note).filter(Boolean))];
    // Keep table captions short: one note only (CV folds can differ slightly).
    const note = notes[0] || null;
    const diagnosis = diagnoseFit(
      { r2: trainAgg.r2 },
      { r2: testAgg.r2 },
    );
    return {
      model: modelId,
      label,
      train: { r2: trainAgg.r2, rmse: trainAgg.rmse, mae: trainAgg.mae, r2_std: trainAgg.r2_std },
      test: { r2: testAgg.r2, rmse: testAgg.rmse, mae: testAgg.mae, r2_std: testAgg.r2_std },
      importance,
      note,
      failed: false,
      diagnosis,
      folds: ok.length,
    };
  }).sort((a, b) => {
    const br = Number.isFinite(b.test?.r2) ? b.test.r2 : -Infinity;
    const ar = Number.isFinite(a.test?.r2) ? a.test.r2 : -Infinity;
    return br - ar;
  });

  report('Done', { phase: 'done', pct: 100 });
  return {
    n: built.n,
    nTrain: splitMeta.nTrain,
    nTest: splitMeta.nTest,
    foldsUsed: splitMeta.foldsUsed,
    foldsRequested: nFolds,
    cvFallbackNote,
    nFeaturesIn: built.featureNames.length,
    nFeaturesOut: pruned.featureNames.length,
    vifMax,
    imputedCells: built.imputedCells || 0,
    imputeMissing: !!imputeMissing,
    droppedIncomplete: built.droppedIncomplete || 0,
    vifDropped: [
      ...(screened.dropped || []),
      ...pruned.dropped.map((f) => ({ feature: f, vif: null })),
    ],
    vifKept: (screened.vifs || [])
      .filter((v) => pruned.featureNames.includes(v.feature))
      .sort((a, b) => (b.vif || 0) - (a.vif || 0)),
    featureMeans: Object.fromEntries(pruned.featureNames.map((n, i) => [n, means[i]])),
    featureSds: Object.fromEntries(pruned.featureNames.map((n, i) => [n, sds[i]])),
    results,
  };
}
