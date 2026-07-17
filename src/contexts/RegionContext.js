import React, { createContext, useContext, useState } from 'react';

const RegionContext = createContext();

export const REGIONS = {
  GLOBAL: 'global',
  CHINA: 'china',
};

export const LANGUAGES = {
  EN: 'en',
  ZH: 'zh',
};

// UI strings for bilingual support
export const i18n = {
  en: {
    regionLabel: 'Region',
    globalMode: 'Global',
    chinaMode: 'China',
    languageToggle: '中文',
    imageDataset: 'Step 1 - Media Dataset',
    datasetProvider: 'Dataset Provider',
    huggingface: 'Hugging Face',
    modelscope: 'ModelScope (魔搭)',
    hfToken: 'HuggingFace Access Token (Optional)',
    msToken: 'ModelScope Access Token (Optional)',
    hfDatasetName: 'HuggingFace Dataset Name',
    msDatasetName: 'ModelScope Dataset Name',
    hfPlaceholder: 'e.g. sijiey/Thermal-Affordance-Dataset',
    msPlaceholder: 'e.g. sijiey/Thermal-Affordance-Dataset',
    hfTokenHelp: 'Optional: only for private datasets. Get from huggingface.co/settings/tokens',
    msTokenHelp: 'Optional: only for private datasets. Get from modelscope.cn/my/myaccesstoken',
    hfBrowse: 'Browse HuggingFace Datasets',
    msBrowse: 'Browse ModelScope Datasets',
    saveConfig: 'Save Configuration',
    testConnection: 'Test Connection',
    deploymentGuide: 'Deployment Guide',
    globalDeployment: 'Vercel Deployment',
    chinaDeployment: 'Zeabur Deployment (China)',
    storageProvider: 'Image Storage Provider',
    supabase: 'Supabase Storage',
    aliyunOss: 'Alibaba Cloud OSS',
    chinaModeBanner: '🇨🇳 China Mode enabled — Using ModelScope, Alibaba Cloud OSS, and Zeabur',
  },
  zh: {
    regionLabel: '区域',
    globalMode: '全球',
    chinaMode: '中国',
    languageToggle: 'English',
    imageDataset: '媒体数据集',
    datasetProvider: '数据集平台',
    huggingface: 'Hugging Face',
    modelscope: 'ModelScope（魔搭）',
    hfToken: 'HuggingFace 访问令牌（可选）',
    msToken: 'ModelScope 访问令牌（可选）',
    hfDatasetName: 'HuggingFace 数据集名称',
    msDatasetName: 'ModelScope 数据集名称',
    hfPlaceholder: '如 sijiey/Thermal-Affordance-Dataset',
    msPlaceholder: '如 sijiey/Thermal-Affordance-Dataset',
    hfTokenHelp: '可选：仅私有数据集需要。前往 huggingface.co/settings/tokens 获取',
    msTokenHelp: '可选：仅私有数据集需要。前往 modelscope.cn/my/myaccesstoken 获取',
    hfBrowse: '浏览 HuggingFace 数据集',
    msBrowse: '浏览 ModelScope 数据集',
    saveConfig: '保存配置',
    testConnection: '测试连接',
    deploymentGuide: '部署指引',
    globalDeployment: 'Vercel 部署',
    chinaDeployment: 'Zeabur 部署（中国可用）',
    storageProvider: '图片存储平台',
    supabase: 'Supabase 存储',
    aliyunOss: '阿里云 OSS',
    chinaModeBanner: '🇨🇳 中国区模式已启用 — 使用 ModelScope、阿里云 OSS 与 Zeabur',
  },
};

export function RegionProvider({ children }) {
  const [region, setRegionState] = useState(
    () => localStorage.getItem('sp-survey-region') || REGIONS.GLOBAL
  );
  const [language, setLanguageState] = useState(
    () => localStorage.getItem('sp-survey-language') || LANGUAGES.EN
  );

  const setRegion = (r) => {
    setRegionState(r);
    localStorage.setItem('sp-survey-region', r);
    // Auto-switch language when entering China mode
    if (r === REGIONS.CHINA) {
      setLanguageState(LANGUAGES.ZH);
      localStorage.setItem('sp-survey-language', LANGUAGES.ZH);
    } else {
      setLanguageState(LANGUAGES.EN);
      localStorage.setItem('sp-survey-language', LANGUAGES.EN);
    }
  };

  const setLanguage = (l) => {
    setLanguageState(l);
    localStorage.setItem('sp-survey-language', l);
  };

  const isChinaMode = region === REGIONS.CHINA;
  const t = i18n[language];

  return (
    <RegionContext.Provider value={{ region, setRegion, language, setLanguage, isChinaMode, t }}>
      {children}
    </RegionContext.Provider>
  );
}

export const useRegion = () => {
  const ctx = useContext(RegionContext);
  if (!ctx) throw new Error('useRegion must be used within RegionProvider');
  return ctx;
};
