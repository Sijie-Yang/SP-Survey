import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { adminI18n } from './adminI18n';
import { interfaceDictionary, normalizeUiLanguage } from '../lib/uiLanguages';
import { onLocaleBundleLoaded } from './localeBundles';

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
    tabHost: '3. Host',
    hostTitle: 'Host',
    hostDescription:
      'Set up Supabase, release the participant snapshot, then deploy the participant site and save its URL.',
    serverTitle: 'Backend / Supabase',
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
      'On Host, set up Supabase, release a participant snapshot, and deploy the participant site. Then copy the link on Share.',
    introFlow5Body:
      'After data comes in, open Results Analysis to summarize and export. A localhost agent can also read results.',
    introStep3Blurb: 'Set up Supabase, release the participant snapshot, then deploy the participant site and save its URL.',
    shareDescription:
      'Copy the survey link, download the QR code, and run a pre-launch test before inviting participants.',
    connectCodex: 'Open AI Assistant',
    aiSettingsLocalKeyIntro: 'Connect an OpenAI or OpenRouter API key for this browser. There is no free hosted model.',
    aiSidebarEmptyConnect: 'Open Settings to connect your own API key.',
    guideShareHeadline: 'Release, deploy and share',
    guideShareWhy: 'Turns your draft into the participant version. You deploy the participant site yourself (for example on Vercel), and responses go to your own Supabase.',
    guideShareDo: 'On Host: set up Supabase, fix anything the pre-launch check flags, release the snapshot, then deploy the participant site and save its URL. On Share: copy the link or download the QR code.',
    guideShareEmpty: 'Not released yet. Release on Host, then deploy the participant site.',
    guideTourTabsBody: 'Work left to right: Media, Builder, Host, Share, Results. Practice and Silicon help you test.',
    guideTourMoreBody: 'Theme, Skills library and GitHub.',
    guideTourLiveBody: 'Opens the local Live Survey in a new tab. The public link is the participant site you deploy on Host.',
    guideAiSetupHint: 'The Assistant uses your own API key (DeepSeek, OpenRouter, OpenAI and others), stored by your local SP-Survey server.',
    guideMcpTitle: 'Advanced: Codex, Cursor or Claude Code on this computer',
    guideMcpBody: 'Open the SP-Survey folder in your coding agent while npm run dev is running. It edits the same local draft through the localhost agent API, with the same checks. Example prompt:',
    guideMcpExample: 'Use the SP-Survey local agent API (GET http://localhost:3001/api/agent first). Create a survey about <your topic>.\nAdd question types <question types>.\nMy media is <description> in the folder <folder>.',
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
    tabHost: '3. 部署',
    hostTitle: '部署',
    hostDescription: '配置 Supabase，发布参与者快照，再部署参与者站点并保存其地址。',
    serverTitle: '后端 / Supabase',
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
      '在「部署」页签配置 Supabase、发布参与者快照并部署参与者站点。然后到「分享」复制链接。',
    introFlow5Body:
      '有数据后打开结果分析进行汇总和导出。本机 agent 也可以读取结果。',
    introStep3Blurb: '配置 Supabase，发布参与者快照，再部署参与者站点并保存其地址。',
    shareDescription:
      '复制问卷链接、下载二维码，并发出问卷前先试跑一次。',
    connectCodex: '打开 AI 助手',
    aiSettingsLocalKeyIntro: '在此浏览器连接 OpenAI 或 OpenRouter API key。没有免费托管模型。',
    aiSidebarEmptyConnect: '打开设置，连接你自己的 API key。',
    guideShareHeadline: '发布、部署并分享',
    guideShareWhy: '把草稿变成参与者版本。参与者站点由你自己部署（例如 Vercel），答卷写入你自己的 Supabase。',
    guideShareDo: '在「部署」页：配置 Supabase，处理发布前检查提示的问题，发布快照，再部署参与者站点并保存地址。在「分享」页：复制链接或下载二维码。',
    guideShareEmpty: '尚未发布。请先在「部署」页发布，再部署参与者站点。',
    guideTourTabsBody: '从左到右：媒体、设计、部署、分享、结果。「试填」和「硅基」用于测试。',
    guideTourMoreBody: '主题、Skill 库和 GitHub。',
    guideTourLiveBody: '在新标签页打开本机的线上问卷预览。公开链接是你在「部署」页部署的参与者站点。',
    guideAiSetupHint: 'AI 助手使用你自己的 API 密钥（DeepSeek、OpenRouter、OpenAI 等），由本机 SP-Survey 服务保存。',
    guideMcpTitle: '进阶：本机的 Codex、Cursor 或 Claude Code',
    guideMcpBody: '在 npm run dev 运行时，用编程 agent 打开 SP-Survey 文件夹。它通过本机 agent API 编辑同一份草稿，检查规则相同。示例提示词：',
    guideMcpExample: '使用 SP-Survey 本地 agent API（先 GET http://localhost:3001/api/agent）。创建一份关于 <你的主题> 的问卷。\n加入题型 <题型说明>。\n我的媒体是 <描述>，在文件夹 <文件夹> 里。',
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
    () => normalizeUiLanguage(localStorage.getItem('sp-survey-language') || LANGUAGES.EN)
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
    const next = normalizeUiLanguage(l);
    setLanguageState(next);
    localStorage.setItem('sp-survey-language', next);
  };

  // Re-render once a lazily loaded language bundle arrives (UI or survey language).
  const [bundleVersion, setBundleVersion] = useState(0);
  useEffect(() => onLocaleBundleLoaded(() => setBundleVersion((n) => n + 1)), []);

  const isChinaMode = region === REGIONS.CHINA;
  const t = useMemo(() => {
    // Self-hosted wording (Host tab, your own Supabase) wins over the shared text.
    const base = interfaceDictionary(language);
    const overlay = String(language).toLowerCase().startsWith('zh') ? OSS_I18N.zh : (language === 'en' ? OSS_I18N.en : null);
    return overlay ? { ...base, ...overlay } : base;
  }, [language, bundleVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // A stable value keeps every useRegion() consumer from re-rendering when
  // the provider's parent re-renders.
  const value = useMemo(
    () => ({ region, setRegion, language, setLanguage, isChinaMode, t, bundleVersion }),
    [region, language, isChinaMode, t, bundleVersion], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <RegionContext.Provider value={value}>
      {children}
    </RegionContext.Provider>
  );
}

export const useRegion = () => {
  const ctx = useContext(RegionContext);
  if (!ctx) throw new Error('useRegion must be used within RegionProvider');
  return ctx;
};
