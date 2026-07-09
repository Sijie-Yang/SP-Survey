import { createContext } from 'react';

// Carries a Map<imageName, url> built from currentProject.preloadedImages so
// analysis components can resolve bare filenames stored in responses back to
// displayable URLs. Provided by ResultsAnalysis.
export const ImageResolverContext = createContext(null);
