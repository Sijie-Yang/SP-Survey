import { sanitizeProjectForIde } from './fileSystemManager';

describe('AI / IDE project export', () => {
  test('removes credentials recursively without changing survey structure', () => {
    const source = {
      supabaseConfig: { supabaseKey: 'service-secret' },
      imageDatasetConfig: {
        supabaseKey: 'service-secret',
        supabaseAnonKey: 'anon-secret',
        huggingFaceToken: 'hf-secret',
        folderTags: { parks: 'category' },
      },
      pages: [{
        name: 'page1',
        elements: [{ name: 'q1', type: 'rating', apiKey: 'secret', rateMax: 7 }],
      }],
    };

    const cleaned = sanitizeProjectForIde(source);

    expect(cleaned.supabaseConfig).toBeUndefined();
    expect(cleaned.imageDatasetConfig.supabaseKey).toBeUndefined();
    expect(cleaned.imageDatasetConfig.supabaseAnonKey).toBeUndefined();
    expect(cleaned.imageDatasetConfig.huggingFaceToken).toBeUndefined();
    expect(cleaned.imageDatasetConfig.folderTags).toEqual({ parks: 'category' });
    expect(cleaned.pages[0].elements[0]).toEqual({ name: 'q1', type: 'rating', rateMax: 7 });
    expect(source.imageDatasetConfig.supabaseKey).toBe('service-secret');
  });
});
