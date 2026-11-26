import { useCallback, useRef, useState } from 'react';
import { buildExampleZip, readSpSchemeUpload } from '../../lib/spScheme';
import { bundleSpSchemeFiles, prepareSpSchemeUpload, revalidateSpSchemeUpload } from '../../lib/spSchemeImport';
import { importIntoStudio } from '../../lib/studioImport';

function readBytes(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(new Uint8Array(e.target.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Studio's import flow: read what was dropped (several files are zipped
 * together), check it the same way the classic editor and the MCP do, let
 * the researcher change the allowed sites, then import all or nothing.
 */
export default function useStudioImport() {
  const [prepared, setPrepared] = useState(null);
  const [report, setReport] = useState(null);
  const [allowed, setAllowed] = useState([]);
  const [readError, setReadError] = useState('');
  const [importError, setImportError] = useState(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(null);
  const busy = useRef(false);

  const prepareBytes = useCallback((bytes, name) => {
    setReadError('');
    setImportError(null);
    try {
      const next = prepareSpSchemeUpload(readSpSchemeUpload(bytes), { name });
      setPrepared(next);
      setReport(next.report);
      setAllowed(next.allowed);
    } catch (err) {
      setPrepared(null);
      setReport(null);
      setReadError(err?.message || String(err));
    }
  }, []);

  const readFiles = useCallback(async (list) => {
    const files = Array.from(list || []).filter(Boolean);
    if (!files.length || busy.current) return;
    try {
      const contents = await Promise.all(files.map(readBytes));
      const bundled = bundleSpSchemeFiles(files.map((file, i) => ({ name: file.name, bytes: contents[i] })));
      if (bundled) prepareBytes(bundled.bytes, bundled.name);
    } catch (err) {
      setReadError(err?.message || String(err));
    }
  }, [prepareBytes]);

  const startExample = useCallback(() => {
    if (busy.current) return;
    prepareBytes(buildExampleZip(), 'street-perception-example.zip');
  }, [prepareBytes]);

  const toggleHost = useCallback((host) => {
    if (!prepared || busy.current) return;
    const next = allowed.includes(host) ? allowed.filter((h) => h !== host) : [...allowed, host];
    setAllowed(next);
    setReport(revalidateSpSchemeUpload(prepared.upload, next));
  }, [prepared, allowed]);

  const reset = useCallback(() => {
    if (busy.current) return;
    setPrepared(null);
    setReport(null);
    setAllowed([]);
    setReadError('');
    setImportError(null);
    setProgress(null);
  }, []);

  /** Import into `project` (replace its page) or into a new project. */
  const runImport = useCallback(async ({ project = null, userId = null, fallbackName }) => {
    if (!prepared || !report?.ok || busy.current) return null;
    busy.current = true;
    setImporting(true);
    setImportError(null);
    setProgress(null);
    try {
      return await importIntoStudio({
        prepared: { ...prepared, report, allowed },
        project,
        userId,
        fallbackName,
        onProgress: setProgress,
      });
    } catch (err) {
      setImportError(err);
      return null;
    } finally {
      busy.current = false;
      setImporting(false);
      setProgress(null);
    }
  }, [prepared, report, allowed]);

  return {
    prepared,
    report,
    allowed,
    readError,
    importError,
    importing,
    progress,
    readFiles,
    startExample,
    toggleHost,
    reset,
    runImport,
  };
}
