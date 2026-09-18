import React, { createContext, useContext, useState } from 'react';
import { adminI18n } from './adminI18n';

export const RegionContext = createContext();

export const REGIONS = {
  GLOBAL: 'global',
  CHINA: 'china',
};

export const LANGUAGES = {
  EN: 'en',
  ZH: 'zh',
};

const OSS_I18N = {
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
    tabServer: 'Server',
    serverTitle: 'Server Setup',
    serverDescription: 'Set up your Supabase database table to store survey responses.',
    mediaDescription:
      'Upload images, videos, and audio to your Supabase Storage. Organize folders and tag them as set or category for survey assignment.',
    builderDescription:
      'Build your survey with pages, questions, and theme. Use the AI Assistant sidebar (your own API key) to draft and refine questions, then preview before sharing.',
    introBody:
      'Design with the AI Assistant sidebar first (your own API key). Localhost Codex / Cursor remains an optional advanced path.',
    introFlowTitle: 'Recommended: in-browser AI Assistant',
    introFlowLead:
      'Store an OpenAI or OpenRouter key, then talk to the Assistant from the right sidebar on any Admin tab. Models stay on your key — this app does not provide free or subsidized models.',
    introFlow1Title: 'Save an API key',
    introFlow1Body:
      'Open the AI sidebar Settings and add your OpenAI or OpenRouter key. Validate it, then describe the survey you want.',
    introFlow3Body:
      'For images/video/audio, upload in Media Dataset. Do not generate synthetic media for upload. For set/category modes, tag folders as set or category.',
    introFlow4Body:
      'Review the draft in Share, release a participant snapshot, then deploy the participant site when you are ready.',
    introFlow5Body:
      'After data comes in, open Results Analysis to summarize and export. A localhost agent can also read results.',
    introStep3Blurb: 'Review the draft, release it when ready, then deploy the participant site and copy the link.',
    shareDescription:
      'Release a participant snapshot, copy the survey link, then deploy the participant site when you are ready.',
    connectCodex: 'Open AI Assistant',
    aiSettingsLocalKeyIntro: 'Connect an OpenAI or OpenRouter API key for this browser. There is no free hosted model.',
    aiSidebarEmptyConnect: 'Open Settings to connect your own API key.',
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
    tabServer: '服务器',
    serverTitle: '服务器设置',
    serverDescription: '配置用于存储问卷回答的 Supabase 数据表。',
    mediaDescription:
      '将图片、视频和音频上传到你的 Supabase Storage。用文件夹整理，并标记为 set 或 category 供问卷调用。',
    builderDescription:
      '用页面、题目和主题搭建问卷。从右侧 AI 助手边栏（使用你自己的 API key）起草和调整题目，然后预览再分享。',
    introBody:
      '先用右侧 AI 助手边栏设计问卷（使用你自己的 API key）。本机 Codex / Cursor 仍是可选的进阶路径。',
    introFlowTitle: '推荐：浏览器内 AI 助手',
    introFlowLead:
      '保存 OpenAI 或 OpenRouter key，然后在任意 Admin 标签页从右侧边栏与助手对话。模型只走你的 key，本应用不提供免费或补贴模型。',
    introFlow1Title: '保存 API key',
    introFlow1Body:
      '打开 AI 边栏设置，添加你的 OpenAI 或 OpenRouter key 并验证，然后描述你想要的问卷。',
    introFlow3Body:
      '图片/视频/音频请在媒体数据集中上传。不要生成合成媒体再上传。set/category 模式请给文件夹打对应标签。',
    introFlow4Body:
      '在分享页检查草稿，发布参与者快照，准备好后再部署参与者站点。',
    introFlow5Body:
      '有数据后打开结果分析进行汇总和导出。本机 agent 也可以读取结果。',
    introStep3Blurb: '检查草稿，准备好后发布，然后部署参与者站点并复制链接。',
    shareDescription:
      '发布参与者快照、复制问卷链接，准备好后再部署参与者站点。',
    connectCodex: '打开 AI 助手',
    aiSettingsLocalKeyIntro: '在此浏览器连接 OpenAI 或 OpenRouter API key。没有免费托管模型。',
    aiSidebarEmptyConnect: '打开设置，连接你自己的 API key。',
  },
};

export const i18n = {
  en: { ...(adminI18n.en || {}), ...OSS_I18N.en },
  zh: { ...(adminI18n.zh || {}), ...OSS_I18N.zh },
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
