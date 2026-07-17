import React from 'react';
import {
  ReactQuestionFactory, SurveyQuestionImagePicker,
} from 'survey-react-ui';
import { Serializer, Question, QuestionMatrixModel, QuestionBooleanModel, CustomError } from 'survey-core';
import ImageRankingWidget from './ImageRankingWidget';
import ImageRatingWidget from './ImageRatingWidget';
import ImageBooleanWidget from './ImageBooleanWidget';
import SurveyJsMatrixControl, { normalizeMatrixAxis } from './SurveyJsMatrixControl';
import {
  MediaDisplayContent, MediaRatingContent, MediaBooleanContent, MediaPickerContent,
  MediaSlotLayout,
} from './MediaWidgets';
import { SliderGroupContent, PointAllocationContent, ImageSliderGroupContent, ImagePointAllocationContent } from './ResponseWidgets';
import ImageAnnotationCanvas from './ImageAnnotationWidget';
import SkillQuestionFrame from './SkillQuestionWidget';
import { readSkillQuestionFields } from '../lib/skillPostMessage';
import { inferMediaType } from '../lib/mediaUtils';
import { resolveQuestionMediaItems } from '../lib/surveyMediaInjection';
import { resolveQuestionSlots } from '../lib/mediaSlots';
import { withTrialShell } from './TrialShell';
import {
  allTrialsAnswered,
  getTrialCount,
  getTrialsAnswer,
  isTrialsAnswer,
  normalizeTrialsAnswer,
  persistTrialsAnswer,
  questionUnitHasAnswer,
} from '../lib/trialNavigation';
import { resolveQuestionImageChoices } from '../lib/questionImageChoices';

/** Restore multi-trial drafts without leaving {trials} on question.value (breaks widgets). */
function ingestTrialsValue(question, newValue, toFlat) {
  if (!isTrialsAnswer(newValue)) return false;
  const normalized = normalizeTrialsAnswer(newValue, getTrialCount(question));
  persistTrialsAnswer(question, normalized, 0);
  toFlat(normalized.trials?.[0]?.value);
  return true;
}

function ensureTrialCountProperty(className) {
  try {
    if (!Serializer.findProperty(className, 'trialCount')) {
      Serializer.addProperty(className, {
        name: 'trialCount:number',
        default: 1,
        category: 'general',
      });
    }
    if (!Serializer.findProperty(className, 'trialMediaSets')) {
      Serializer.addProperty(className, {
        name: 'trialMediaSets',
        default: null,
        category: 'general',
        visible: false,
      });
    }
    if (!Serializer.findProperty(className, 'spTrialsAnswer')) {
      Serializer.addProperty(className, {
        name: 'spTrialsAnswer',
        default: null,
        category: 'general',
        visible: false,
        isSerializable: false,
      });
    }
  } catch {
    /* ignore */
  }
}

/** Ensure base question class can carry trial media through Model() serialization. */
try {
  if (!Serializer.findProperty('question', 'trialCount')) {
    Serializer.addProperty('question', {
      name: 'trialCount:number',
      default: 1,
      category: 'general',
      visible: false,
    });
  }
  if (!Serializer.findProperty('question', 'trialMediaSets')) {
    Serializer.addProperty('question', {
      name: 'trialMediaSets',
      default: null,
      category: 'general',
      visible: false,
    });
  }
  if (!Serializer.findProperty('question', 'spTrialsAnswer')) {
    Serializer.addProperty('question', {
      name: 'spTrialsAnswer',
      default: null,
      category: 'general',
      visible: false,
      isSerializable: false,
    });
  }
} catch {
  /* ignore */
}

function registerTrialAwareQuestion(typeName, Component) {
  ensureTrialCountProperty(typeName);
  const Wrapped = withTrialShell(Component);
  ReactQuestionFactory.Instance.registerQuestion(typeName, (props) => (
    React.createElement(Wrapped, props)
  ));
}

// Define the custom question type
const WIDGET_NAME = 'imageranking';

// Register the custom question type with SurveyJS
export function registerImageRankingWidget() {
  console.log('Registering ImageRanking widget...');
  
  // First, add imageLink property to ItemValue
  Serializer.addProperty('itemvalue', {
    name: 'imageLink',
    category: 'general'
  });
  
  console.log('Added imageLink property to itemvalue');

  // Add custom properties to the serializer
  Serializer.addClass(
    WIDGET_NAME,
    [
      {
        name: 'choices:itemvalue[]',
        category: 'choices',
      },
      {
        name: 'imageCount:number',
        default: 4,
        category: 'general',
      },
      {
        name: 'imageSelectionMode',
        default: 'random',
        choices: ['random', 'manual'],
        category: 'general',
      },
      {
        name: 'selectedImageUrls:string[]',
        category: 'general',
      },
      {
        name: 'randomImageSelection:boolean',
        default: false,
        category: 'general',
      },
      {
        name: 'bucketPath',
        category: 'general',
      },
      {
        name: 'supabaseConfig',
        category: 'general',
      },
      {
        name: 'imageFit',
        default: 'cover',
        category: 'general',
      },
    ],
    function () {
      return new ImageRankingQuestion();
    },
    'question'
  );

  // Register the React component (multi-trial shell when trialCount > 1)
  registerTrialAwareQuestion(WIDGET_NAME, ImageRankingQuestionComponent);
  
  console.log('ImageRanking widget registered successfully');
}

// Custom Question Class
class ImageRankingQuestion extends Question {
  getType() {
    return WIDGET_NAME;
  }

  // Ensure the value is always an array
  getValueCore() {
    const val = super.getValueCore();
    return Array.isArray(val) ? val : [];
  }

  setValueCore(newValue) {
    if (ingestTrialsValue(this, newValue, (flat) => {
      super.setValueCore(Array.isArray(flat) ? flat : []);
    })) return;
    if (Array.isArray(newValue)) {
      super.setValueCore(newValue);
    }
  }

  isEmpty() {
    const n = getTrialCount(this);
    if (n > 1) return !allTrialsAnswered(getTrialsAnswer(this) || this.value, n);
    return super.isEmpty();
  }
}

// React Component Wrapper
function ImageRankingQuestionComponent(props) {
  const { question, trialStimulusMedia = null } = props;

  const handleValueChange = (newValue) => {
    question.value = newValue;
  };

  const images = resolveQuestionImageChoices(question, trialStimulusMedia);
  if (!images.length) {
    return (
      <div style={{ padding: '20px', border: '1px solid rgba(0,0,0,0.12)', backgroundColor: '#f9f9f9' }}>
        <p>No images available for this ranking trial yet.</p>
        <p>Question type: {question.getType()}</p>
      </div>
    );
  }

  // Ensure choices stay populated for ImageRankingWidget (ItemValue / imageLinks fallback)
  if (!question.choices?.length) {
    try {
      question.choices = images.map((img) => ({
        value: img.value,
        imageLink: img.imageLink,
        imageName: img.imageName,
      }));
    } catch { /* ignore */ }
  }

  return (
    <ImageRankingWidget
      question={question}
      value={question.value}
      onValueChanged={handleValueChange}
      trialStimulusMedia={trialStimulusMedia}
    />
  );
}

// Register Image Rating Widget
export function registerImageRatingWidget() {
  console.log('Registering ImageRating widget...');
  
  const RATING_WIDGET_NAME = 'imagerating';
  
  // First, add imageLink property to ItemValue (if not already added)
  Serializer.addProperty('itemvalue', {
    name: 'imageLink',
    category: 'general'
  });
  
  console.log('Added imageLink property to itemvalue for rating');

  // Add custom properties to the serializer
  Serializer.addClass(
    RATING_WIDGET_NAME,
    [
      {
        name: 'choices:itemvalue[]',
        category: 'choices',
      },
      {
        name: 'imageCount:number',
        default: 1,
        category: 'general',
      },
      {
        name: 'imageSelectionMode',
        default: 'random',
        choices: ['random', 'manual'],
        category: 'general',
      },
      {
        name: 'selectedImageUrls:string[]',
        category: 'general',
      },
      {
        name: 'randomImageSelection:boolean',
        default: false,
        category: 'general',
      },
      {
        name: 'bucketPath',
        category: 'general',
      },
      {
        name: 'supabaseConfig',
        category: 'general',
      },
      {
        name: 'imageFit',
        default: 'cover',
        category: 'general',
      },
      {
        name: 'rateMin:number',
        default: 1,
        category: 'general',
      },
      {
        name: 'rateMax:number',
        default: 5,
        category: 'general',
      },
      {
        name: 'minRateDescription',
        category: 'general',
      },
      {
        name: 'maxRateDescription',
        category: 'general',
      },
      { name: 'imageHtml:string', category: 'general' },
      { name: 'imageLinks:string[]', category: 'general', default: [] },
      { name: 'imageNames:string[]', category: 'general', default: [] },
      { name: 'imageUrls:string[]', category: 'general', default: [] },
    ],
    function () {
      return new ImageRatingQuestion();
    },
    'question'
  );

  registerTrialAwareQuestion(RATING_WIDGET_NAME, ImageRatingQuestionComponent);
  
  console.log('ImageRating widget registered successfully');
}

// Custom Question Class for Image Rating
class ImageRatingQuestion extends Question {
  getType() {
    return 'imagerating';
  }

  // Flat rating number while answering; multi-trial payload lives on spTrialsAnswer
  getValueCore() {
    const val = super.getValueCore();
    if (isTrialsAnswer(val)) return val;
    return typeof val === 'number' ? val : null;
  }

  setValueCore(newValue) {
    if (ingestTrialsValue(this, newValue, (flat) => {
      super.setValueCore(typeof flat === 'number' ? flat : null);
    })) return;
    if (typeof newValue === 'number' || newValue === null) {
      super.setValueCore(newValue);
    }
  }

  isEmpty() {
    const n = getTrialCount(this);
    if (n > 1) return !allTrialsAnswered(getTrialsAnswer(this) || this.value, n);
    return super.isEmpty();
  }
}

// React Component Wrapper for Image Rating
function ImageRatingQuestionComponent(props) {
  const { question, trialStimulusMedia = null } = props;

  const handleValueChange = (newValue) => {
    question.value = newValue;
  };

  const images = resolveQuestionImageChoices(question, trialStimulusMedia);
  if (!images.length && !(trialStimulusMedia?.length) && !question?.imageHtml) {
    return (
      <div style={{ padding: '20px', border: '1px solid rgba(0,0,0,0.12)', backgroundColor: '#f9f9f9' }}>
        <p>No images available for this rating trial yet.</p>
        <p>Question type: {question.getType()}</p>
      </div>
    );
  }

  // Return only the widget content, let SurveyJS handle the question wrapper, title, and description
  return (
    <ImageRatingWidget
      question={question}
      value={question.value}
      onValueChanged={handleValueChange}
      trialStimulusMedia={trialStimulusMedia}
    />
  );
}

// Register Image Boolean Widget
export function registerImageBooleanWidget() {
  const BOOLEAN_WIDGET_NAME = 'imageboolean';
  const creator = () => new ImageBooleanQuestion();

  try {
    if (!Serializer.findProperty('itemvalue', 'imageLink')) {
      Serializer.addProperty('itemvalue', {
        name: 'imageLink',
        category: 'general',
      });
    }
  } catch { /* already present */ }

  if (!Serializer.findClass(BOOLEAN_WIDGET_NAME)) {
    Serializer.addClass(
      BOOLEAN_WIDGET_NAME,
      [
        { name: 'choices:itemvalue[]', category: 'choices' },
        { name: 'imageCount:number', default: 1, category: 'general' },
        { name: 'imageSelectionMode', default: 'random', choices: ['random', 'manual'], category: 'general' },
        { name: 'selectedImageUrls:string[]', category: 'general' },
        { name: 'randomImageSelection:boolean', default: false, category: 'general' },
        { name: 'bucketPath', category: 'general' },
        { name: 'supabaseConfig', category: 'general' },
        { name: 'imageFit', default: 'cover', category: 'general' },
        { name: 'imageSource', default: 'huggingface', category: 'general' },
        { name: 'huggingFaceConfig:object', category: 'general' },
        { name: 'imageHtml:string', category: 'general' },
        { name: 'imageLinks:string[]', category: 'general', default: [] },
        { name: 'imageNames:string[]', category: 'general', default: [] },
      ],
      creator,
      'boolean',
    );
  } else {
    try { Serializer.overrideClassCreator(BOOLEAN_WIDGET_NAME, creator); } catch { /* ignore */ }
  }

  registerTrialAwareQuestion(BOOLEAN_WIDGET_NAME, ImageBooleanQuestionComponent);
}

// Custom Question Class for Image Boolean
class ImageBooleanQuestion extends QuestionBooleanModel {
  getType() {
    return 'imageboolean';
  }

  /** Theme CSS is keyed by type name; reuse native boolean styles. */
  getCssType() {
    return 'boolean';
  }

  setValueCore(newValue) {
    if (ingestTrialsValue(this, newValue, (flat) => {
      super.setValueCore(typeof flat === 'boolean' ? flat : null);
    })) return;
    if (typeof newValue === 'boolean' || newValue === null || newValue === undefined) {
      super.setValueCore(newValue);
    }
  }

  isEmpty() {
    const n = getTrialCount(this);
    if (n > 1) return !allTrialsAnswered(getTrialsAnswer(this) || this.value, n);
    return super.isEmpty();
  }
}

// React Component Wrapper for Image Boolean
function ImageBooleanQuestionComponent(props) {
  const { question, trialStimulusMedia = null } = props;

  return (
    <ImageBooleanWidget
      question={question}
      value={question.value}
      onValueChanged={(newValue) => { question.value = newValue; }}
      trialStimulusMedia={trialStimulusMedia}
    />
  );
}

// ===== IMAGE MATRIX REGISTRATION =====
/** Stimulus above SurveyJS native matrix (same look as single-trial html+matrix panel). */
function ImageMatrixStimulus({ question, trialStimulusMedia = null }) {
  const images = resolveQuestionImageChoices(question, trialStimulusMedia);
  if (!trialStimulusMedia?.length && question?.imageHtml) {
    return (
      <div
        className="sp-imagematrix-html"
        style={{ marginBottom: 16 }}
        dangerouslySetInnerHTML={{ __html: question.imageHtml }}
      />
    );
  }
  const links = images.map((i) => i.imageLink).filter(Boolean);
  const fallback = (!trialStimulusMedia?.length && Array.isArray(question?.imageLinks))
    ? question.imageLinks.filter(Boolean)
    : [];
  const urls = links.length ? links : fallback;
  if (!urls.length) return null;
  return (
    <div
      className="sp-image-gallery"
      style={{
        marginBottom: 16,
        padding: 16,
        backgroundColor: '#f5f5f5',
        borderRadius: 8,
        boxSizing: 'border-box',
      }}
    >
      {urls.map((imageUrl, index) => (
        <div
          key={`${imageUrl}_${index}`}
          className="sp-image-gallery__item"
          style={{
            borderRadius: 8,
            overflow: 'hidden',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            backgroundColor: '#fff',
            lineHeight: 0,
          }}
        >
          <div className="sp-image-gallery__image-container">
            <img src={imageUrl} alt={`Image ${index + 1}`} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function registerImageMatrixWidget() {
  const WIDGET_NAME_MATRIX = 'imagematrix';
  const creator = () => new ImageMatrixQuestion('');
  if (!Serializer.findClass(WIDGET_NAME_MATRIX)) {
    Serializer.addClass(
      WIDGET_NAME_MATRIX,
      [
        { name: 'imageLinks:string[]', category: 'general', default: [] },
        { name: 'imageNames:string[]', category: 'general', default: [] },
        { name: 'imageHtml:string', category: 'general' },
        { name: 'imageCount:number', default: 1, category: 'general' },
        { name: 'imageSelectionMode', default: 'huggingface_random', category: 'general' },
        { name: 'selectedImageUrls:string[]', category: 'general', default: [] },
        { name: 'randomImageSelection:boolean', default: false, category: 'general' },
        { name: 'imageFit', default: 'cover', category: 'general' },
        { name: 'imageSource', default: 'huggingface', category: 'general' },
        { name: 'huggingFaceConfig:object', category: 'general' },
        { name: 'choices:itemvalue[]', category: 'choices' },
      ],
      creator,
      'matrix',
    );
  } else {
    // Hot reload / prior bad registration: force QuestionMatrixModel factory
    try { Serializer.overrideClassCreator(WIDGET_NAME_MATRIX, creator); } catch { /* ignore */ }
  }
  registerTrialAwareQuestion(WIDGET_NAME_MATRIX, ImageMatrixQuestionComponent);
}

/** Must extend QuestionMatrixModel — extending Question breaks SurveyJS page visibility. */
class ImageMatrixQuestion extends QuestionMatrixModel {
  getType() {
    return 'imagematrix';
  }

  /** Theme CSS is keyed by type name; reuse native matrix styles. */
  getCssType() {
    return 'matrix';
  }

  setValueCore(newValue) {
    if (ingestTrialsValue(this, newValue, (flat) => {
      super.setValueCore(flat && typeof flat === 'object' && !Array.isArray(flat) ? flat : {});
    })) return;
    super.setValueCore(newValue);
  }

  isEmpty() {
    const n = getTrialCount(this);
    if (n > 1) return !allTrialsAnswered(getTrialsAnswer(this) || this.value, n, this);
    // One cell selected is not enough — every row must have a column
    return !questionUnitHasAnswer(this, 0);
  }
}

function ImageMatrixQuestionComponent(props) {
  const { question, trialStimulusMedia = null } = props;
  const rows = normalizeMatrixAxis(question.rows);
  const columns = normalizeMatrixAxis(question.columns);

  return (
    <div style={{ width: '100%' }} className="sp-imagematrix">
      <ImageMatrixStimulus question={question} trialStimulusMedia={trialStimulusMedia} />
      <SurveyJsMatrixControl
        name={question.name || 'imagematrix'}
        rows={rows}
        columns={columns}
        value={question.value}
        onChange={(next) => { question.value = next; }}
      />
    </div>
  );
}

// Export default registration function
export default registerImageRankingWidget;

// ── Media question types ──────────────────────────────────────────────────────

const MEDIA_PAIRING_TYPES = [
  'imagepicker', 'imageranking', 'imagerating', 'imageboolean', 'image', 'imagematrix',
  'mediadisplay', 'mediarating', 'mediaboolean', 'mediaranking', 'mediapicker',
  'mediamatrix', 'mediaslidergroup', 'mediapointallocation',
  'imageannotation', 'skillquestion',
  'imageslidergroup', 'imagepointallocation',
];

const SLOT_PROPS = [
  { name: 'mediaSlots', default: [], category: 'general' },
  { name: 'mediaPresentation', default: 'stack', choices: ['stack', 'sequential'], category: 'general' },
  { name: 'mediaSlotsResolved', category: 'general' },
  { name: 'slotIds:string[]', category: 'general' },
  { name: 'slotUrls:string[]', category: 'general' },
  { name: 'slotTypes:string[]', category: 'general' },
  { name: 'slotRoles:string[]', category: 'general' },
  { name: 'slotNames:string[]', category: 'general' },
];

export function registerMediaPairingProps() {
  MEDIA_PAIRING_TYPES.forEach((typeName) => {
    Serializer.addProperty(typeName, {
      name: 'mediaAssignmentMode',
      default: 'individual',
      choices: ['individual', 'set', 'group', 'category'],
      category: 'general',
    });
    Serializer.addProperty(typeName, {
      name: 'mediaFolders',
      category: 'general',
    });
    Serializer.addProperty(typeName, {
      name: 'mediaPerCategory:number',
      default: 1,
      category: 'general',
    });
    Serializer.addProperty(typeName, {
      name: 'assignedMediaSetId',
      category: 'general',
    });
    Serializer.addProperty(typeName, {
      name: 'assignedMediaGroupId',
      category: 'general',
    });
    Serializer.addProperty(typeName, {
      name: 'assignedMediaCategories',
      category: 'general',
    });
  });
}

const MEDIA_PROPS = [
  { name: 'mediaUrl', category: 'general' },
  { name: 'mediaType', default: 'any', choices: ['any', 'image', 'video', 'audio'], category: 'general' },
  { name: 'mediaName', category: 'general' },
  { name: 'imageCount:number', default: 1, category: 'general' },
  { name: 'randomImageSelection:boolean', default: false, category: 'general' },
  { name: 'imageSelectionMode', default: 'random', category: 'general' },
  { name: 'excludePreviouslyUsedImages:boolean', default: true, category: 'general' },
  // Must be registered — otherwise SurveyJS drops injected stimulus on Model()
  { name: 'imageHtml:string', category: 'general' },
  { name: 'imageLinks:string[]', category: 'general' },
  { name: 'imageNames:string[]', category: 'general' },
  { name: 'imageUrls:string[]', category: 'general' },
];

/** Hot-reload safe: ensure stimulus fields exist on already-registered media* classes. */
function ensureMediaStimulusSerializerProps(typeName) {
  [
    { name: 'imageHtml:string', category: 'general' },
    { name: 'imageLinks:string[]', category: 'general' },
    { name: 'imageNames:string[]', category: 'general' },
    { name: 'imageUrls:string[]', category: 'general' },
    { name: 'mediaUrls:string[]', category: 'general' },
    { name: 'mediaNames:string[]', category: 'general' },
    { name: 'mediaTypes:string[]', category: 'general' },
  ].forEach((prop) => {
    try {
      const base = prop.name.split(':')[0];
      if (!Serializer.findProperty(typeName, base)) {
        Serializer.addProperty(typeName, prop);
      }
    } catch { /* ignore */ }
  });
}

function makeMediaQuestion(typeName, parent = 'question') {
  class Q extends Question {
    getType() { return typeName; }
  }
  Serializer.addClass(typeName, [...MEDIA_PROPS, ...SLOT_PROPS], () => new Q(), parent);
}

function mediaStimulusProps(q, trialStimulusMedia = null) {
  const fromTrial = Array.isArray(trialStimulusMedia)
    ? trialStimulusMedia.map((m) => (typeof m === 'string' ? { url: m } : m)).filter((m) => m?.url)
    : [];
  const items = fromTrial.length ? fromTrial : resolveQuestionMediaItems(q);
  const slots = fromTrial.length ? [] : resolveQuestionSlots(q);
  const first = items[0] || slots[0];
  const url = first?.url || q.mediaUrl || '';
  const type = first?.type
    || (q.mediaType === 'any' ? inferMediaType(url) : (q.mediaType || inferMediaType(url)));
  let imageHtml = '';
  try {
    imageHtml = (typeof q.getPropertyValue === 'function' ? q.getPropertyValue('imageHtml') : null)
      || q.imageHtml
      || '';
  } catch { imageHtml = q.imageHtml || ''; }
  return {
    mediaUrl: url,
    mediaType: type,
    mediaName: first?.name || q.mediaName,
    mediaItems: items.length ? items : null,
    mediaSlots: slots.length ? slots : null,
    mediaPresentation: q.mediaPresentation || 'stack',
    imageHtml,
  };
}

/** Stimulus for media* questions — MediaSlotLayout, then imageHtml (same as imagematrix). */
function MediaQuestionStimulus({ question, trialStimulusMedia = null }) {
  const stim = mediaStimulusProps(question, trialStimulusMedia);
  if (stim.mediaSlots?.length || stim.mediaItems?.length) {
    return React.createElement(MediaSlotLayout, {
      slots: stim.mediaSlots,
      items: stim.mediaItems,
      presentation: stim.mediaPresentation,
    });
  }
  if (stim.imageHtml) {
    return React.createElement('div', {
      className: 'sp-media-html-stimulus',
      style: { marginBottom: 16 },
      dangerouslySetInnerHTML: { __html: stim.imageHtml },
    });
  }
  const links = [
    ...(Array.isArray(question?.imageLinks) ? question.imageLinks : []),
    ...(Array.isArray(question?.imageUrls) ? question.imageUrls : []),
  ].filter(Boolean);
  if (!links.length && stim.mediaUrl) links.push(stim.mediaUrl);
  if (!links.length) return null;
  return React.createElement(MediaSlotLayout, {
    items: links.map((url, i) => ({
      url,
      name: question.imageNames?.[i] || `Media ${i + 1}`,
      type: inferMediaType(url),
    })),
    presentation: stim.mediaPresentation,
  });
}

export function registerMediaDisplayWidget() {
  makeMediaQuestion('mediadisplay');
  Serializer.addProperty('mediadisplay', { name: 'mediaItems', default: [], category: 'general' });
  Serializer.addProperty('mediadisplay', { name: 'mediaUrls:string[]', category: 'general' });
  Serializer.addProperty('mediadisplay', { name: 'mediaNames:string[]', category: 'general' });
  Serializer.addProperty('mediadisplay', { name: 'mediaTypes:string[]', category: 'general' });
  Serializer.addProperty('mediadisplay', {
    name: 'displayMode',
    default: 'single',
    choices: ['single', 'sideBySide', 'reveal', 'timed'],
    category: 'general',
  });
  Serializer.addProperty('mediadisplay', { name: 'exposureSeconds:number', default: 5, category: 'general' });
  Serializer.addProperty('mediadisplay', { name: 'beforeLabel', default: 'Before', category: 'general' });
  Serializer.addProperty('mediadisplay', { name: 'afterLabel', default: 'After', category: 'general' });
  function MediaDisplayQuestionComponent({ question: q, trialStimulusMedia = null }) {
    return React.createElement(MediaDisplayContent, {
      ...mediaStimulusProps(q, trialStimulusMedia),
      displayMode: q.displayMode || 'single',
      exposureSeconds: q.exposureSeconds || 5,
      beforeLabel: q.beforeLabel || 'Before',
      afterLabel: q.afterLabel || 'After',
    });
  }
  registerTrialAwareQuestion('mediadisplay', MediaDisplayQuestionComponent);
}

export function registerMediaRatingWidget() {
  makeMediaQuestion('mediarating');
  [
    { name: 'rateMin:number', default: 1, category: 'general' },
    { name: 'rateMax:number', default: 5, category: 'general' },
    // Must be registered — SurveyJS drops unregistered fields on Model(), so live
    // surveys otherwise never see builder low/high-end labels.
    { name: 'minRateDescription', category: 'general' },
    { name: 'maxRateDescription', category: 'general' },
    { name: 'mediaItems', default: [], category: 'general' },
    { name: 'mediaUrls:string[]', category: 'general' },
    { name: 'mediaNames:string[]', category: 'general' },
    { name: 'mediaTypes:string[]', category: 'general' },
  ].forEach((prop) => {
    try {
      const base = prop.name.split(':')[0];
      if (!Serializer.findProperty('mediarating', base)) {
        Serializer.addProperty('mediarating', prop);
      }
    } catch { /* already present */ }
  });
  function MediaRatingQuestionComponent({ question: q, trialStimulusMedia = null }) {
    return React.createElement(MediaRatingContent, {
      ...mediaStimulusProps(q, trialStimulusMedia),
      value: q.value,
      rateMin: q.rateMin ?? 1,
      rateMax: q.rateMax ?? 5,
      minRateDescription: q.minRateDescription || '',
      maxRateDescription: q.maxRateDescription || '',
      onChange: (v) => { q.value = v; },
    });
  }
  registerTrialAwareQuestion('mediarating', MediaRatingQuestionComponent);
}

export function registerMediaBooleanWidget() {
  makeMediaQuestion('mediaboolean', 'boolean');
  [
    { name: 'mediaItems', default: [], category: 'general' },
    { name: 'mediaUrls:string[]', category: 'general' },
    { name: 'mediaNames:string[]', category: 'general' },
    { name: 'mediaTypes:string[]', category: 'general' },
    // Explicit — parent "boolean" props can be dropped on custom media classes.
    { name: 'labelTrue', category: 'general' },
    { name: 'labelFalse', category: 'general' },
  ].forEach((prop) => {
    try {
      const base = prop.name.split(':')[0];
      if (!Serializer.findProperty('mediaboolean', base)) {
        Serializer.addProperty('mediaboolean', prop);
      }
    } catch { /* already present */ }
  });
  function MediaBooleanQuestionComponent({ question: q, trialStimulusMedia = null }) {
    return React.createElement(MediaBooleanContent, {
      ...mediaStimulusProps(q, trialStimulusMedia),
      name: q.name || 'mediaboolean',
      value: q.value,
      labelTrue: q.labelTrue || 'Yes',
      labelFalse: q.labelFalse || 'No',
      onChange: (v) => { q.value = v; },
    });
  }
  registerTrialAwareQuestion('mediaboolean', MediaBooleanQuestionComponent);
}

export function registerMediaPickerWidget() {
  makeMediaQuestion('mediapicker');
  Serializer.addProperty('mediapicker', { name: 'mediaItems', default: [], category: 'general' });
  Serializer.addProperty('mediapicker', { name: 'mediaUrls:string[]', category: 'general' });
  Serializer.addProperty('mediapicker', { name: 'mediaNames:string[]', category: 'general' });
  Serializer.addProperty('mediapicker', { name: 'mediaTypes:string[]', category: 'general' });
  Serializer.addProperty('mediapicker', { name: 'choices:itemvalue[]', category: 'choices' });
  Serializer.addProperty('mediapicker', { name: 'multiSelect:boolean', default: false, category: 'general' });
  function MediaPickerQuestionComponent({ question: q }) {
    const items = resolveQuestionMediaItems(q);
    const slots = resolveQuestionSlots(q);
    return React.createElement(MediaPickerContent, {
      mediaItems: items,
      mediaSlots: slots,
      choices: q.choices || [],
      value: q.value,
      multiSelect: !!q.multiSelect,
      onChange: (v) => { q.value = v; },
    });
  }
  registerTrialAwareQuestion('mediapicker', MediaPickerQuestionComponent);
}

export function registerMediaMatrixWidget() {
  class MediaMatrixQuestion extends QuestionMatrixModel {
    getType() { return 'mediamatrix'; }

    getCssType() { return 'matrix'; }

    setValueCore(newValue) {
      if (ingestTrialsValue(this, newValue, (flat) => {
        super.setValueCore(flat && typeof flat === 'object' && !Array.isArray(flat) ? flat : {});
      })) return;
      super.setValueCore(newValue);
    }

    isEmpty() {
      const n = getTrialCount(this);
      if (n > 1) return !allTrialsAnswered(getTrialsAnswer(this) || this.value, n, this);
      // One cell selected is not enough — every row must have a column
      return !questionUnitHasAnswer(this, 0);
    }
  }

  const mediaMatrixCreator = () => new MediaMatrixQuestion('');
  if (!Serializer.findClass('mediamatrix')) {
    Serializer.addClass(
      'mediamatrix',
      [
        ...MEDIA_PROPS,
        ...SLOT_PROPS,
        { name: 'mediaItems', default: [], category: 'general' },
        { name: 'mediaUrls:string[]', category: 'general' },
        { name: 'mediaNames:string[]', category: 'general' },
        { name: 'mediaTypes:string[]', category: 'general' },
      ],
      mediaMatrixCreator,
      'matrix',
    );
  } else {
    try { Serializer.overrideClassCreator('mediamatrix', mediaMatrixCreator); } catch { /* ignore */ }
  }
  ensureMediaStimulusSerializerProps('mediamatrix');

  function MediaMatrixQuestionComponent({ question: q, trialStimulusMedia = null }) {
    const rows = normalizeMatrixAxis(q.rows);
    const columns = normalizeMatrixAxis(q.columns);
    return React.createElement('div', { style: { width: '100%' }, className: 'sp-mediamatrix' },
      React.createElement(MediaQuestionStimulus, { question: q, trialStimulusMedia }),
      React.createElement(SurveyJsMatrixControl, {
        name: q.name || 'mediamatrix',
        rows,
        columns,
        value: q.value,
        onChange: (next) => { q.value = next; },
      }),
    );
  }
  registerTrialAwareQuestion('mediamatrix', MediaMatrixQuestionComponent);
}

export function registerMediaSliderGroupWidget() {
  class Q extends Question {
    getType() { return 'mediaslidergroup'; }
  }
  Serializer.addClass('mediaslidergroup', [
    ...MEDIA_PROPS, ...SLOT_PROPS,
    { name: 'mediaItems', default: [], category: 'general' },
    { name: 'mediaUrls:string[]', category: 'general' },
    { name: 'mediaNames:string[]', category: 'general' },
    { name: 'mediaTypes:string[]', category: 'general' },
    { name: 'dimensions', default: [], category: 'general' },
    { name: 'scaleMin:number', default: 1, category: 'general' },
    { name: 'scaleMax:number', default: 7, category: 'general' },
  ], () => new Q(), 'question');
  ensureMediaStimulusSerializerProps('mediaslidergroup');

  function MediaSliderGroupQuestionComponent({ question: q, trialStimulusMedia = null }) {
    ensureSliderGroupMidDefaults(q);
    return React.createElement('div', null,
      React.createElement(MediaQuestionStimulus, { question: q, trialStimulusMedia }),
      React.createElement(SliderGroupContent, {
        dimensions: q.dimensions || [],
        scaleMin: q.scaleMin ?? 1,
        scaleMax: q.scaleMax ?? 7,
        value: q.value,
        onChange: (v) => { q.value = v; },
        readOnly: q.isReadOnly,
        autoPersistDefaults: true,
      }),
    );
  }
  registerTrialAwareQuestion('mediaslidergroup', MediaSliderGroupQuestionComponent);
}

export function registerMediaPointAllocationWidget() {
  class Q extends Question {
    getType() { return 'mediapointallocation'; }
  }
  Serializer.addClass('mediapointallocation', [
    ...MEDIA_PROPS, ...SLOT_PROPS,
    { name: 'mediaItems', default: [], category: 'general' },
    { name: 'mediaUrls:string[]', category: 'general' },
    { name: 'mediaNames:string[]', category: 'general' },
    { name: 'mediaTypes:string[]', category: 'general' },
    { name: 'choices', default: [], category: 'general' },
    { name: 'budget:number', default: 100, category: 'general' },
  ], () => new Q(), 'question');
  ensureMediaStimulusSerializerProps('mediapointallocation');

  function MediaPointAllocationQuestionComponent({ question: q, trialStimulusMedia = null }) {
    return React.createElement('div', null,
      React.createElement(MediaQuestionStimulus, { question: q, trialStimulusMedia }),
      React.createElement(PointAllocationContent, {
        choices: q.choices || [],
        budget: q.budget || 100,
        value: q.value,
        onChange: (v) => { q.value = v; },
        readOnly: q.isReadOnly,
      }),
    );
  }
  registerTrialAwareQuestion('mediapointallocation', MediaPointAllocationQuestionComponent);
}

// ── Image annotation question type ────────────────────────────────────────────

export function registerImageAnnotationWidget() {
  const QuestionModel = class extends Question {
    getType() { return 'imageannotation'; }
    validate() {
      const base = super.validate();
      if (base) return base;
      const count = this.value?.shapes?.length || 0;
      const min = this.minAnnotations || 0;
      if (min > 0 && count < min) {
        return `Please add at least ${min} annotation(s).`;
      }
      return '';
    }
  };
  Serializer.addClass('imageannotation', [
    ...MEDIA_PROPS.filter((p) => p.name !== 'mediaUrl' && p.name !== 'mediaName'),
    { name: 'annotationImageUrl', category: 'general' },
    { name: 'allowedTools', default: ['point', 'line', 'region', 'bbox'], category: 'general' },
    { name: 'annotationLabels', default: [], category: 'general' },
    { name: 'minAnnotations:number', default: 0, category: 'general' },
    { name: 'maxAnnotations:number', default: 50, category: 'general' },
    { name: 'enableSamAssist:boolean', default: false, category: 'general' },
    { name: 'falApiKey', category: 'general' },
    { name: 'projectId', category: 'general' },
  ], () => new QuestionModel(), 'question');

  function ImageAnnotationQuestionComponent({ question: q }) {
    const url = q.annotationImageUrl || q.mediaUrl || '';
    return React.createElement(ImageAnnotationCanvas, {
      imageUrl: url,
      value: q.value,
      allowedTools: q.allowedTools || ['point', 'line', 'region', 'bbox'],
      annotationLabels: q.annotationLabels || [],
      minAnnotations: q.minAnnotations || 0,
      maxAnnotations: q.maxAnnotations ?? 50,
      enableSamAssist: false, // never expose SAM in live / practice surveys
      falKey: '',
      projectId: q.projectId || '',
      onChange: (v) => { q.value = v; },
    });
  }
  registerTrialAwareQuestion('imageannotation', ImageAnnotationQuestionComponent);
}

// ── Native response types (slider group / point allocation) ──────────────────

function ensureSliderGroupMidDefaults(q) {
  // Midpoint is a valid answer even if the participant never touches the slider
  // (single- and multi-trial). Persist so TrialShell / required checks see scores.
  const dims = q.dimensions || [];
  if (!dims.length) return;
  const min = q.scaleMin ?? 1;
  const max = q.scaleMax ?? 7;
  const mid = Math.round((Number(min) + Number(max)) / 2);
  const val = (q.value && typeof q.value === 'object' && !Array.isArray(q.value))
    ? { ...q.value }
    : {};
  let changed = false;
  dims.forEach((d) => {
    if (!d?.id) return;
    if (val[d.id] === undefined || val[d.id] === null || val[d.id] === '') {
      val[d.id] = mid;
      changed = true;
    }
  });
  if (changed) q.value = val;
}

export function registerSliderGroupWidget() {
  class Q extends Question {
    getType() { return 'slidergroup'; }
    onCheckForErrors(errors, isOnValueChanged) {
      super.onCheckForErrors(errors, isOnValueChanged);
      if (!this.isRequired || isOnValueChanged) return;
      const dims = this.dimensions || [];
      const val = this.value || {};
      const missing = dims.filter((d) => val[d.id] === undefined || val[d.id] === null);
      if (missing.length) {
        errors.push(new CustomError('Please rate every dimension.', this));
      }
    }
  }
  Serializer.addClass('slidergroup', [
    { name: 'dimensions', default: [], category: 'general' },
    { name: 'scaleMin:number', default: 1, category: 'general' },
    { name: 'scaleMax:number', default: 7, category: 'general' },
  ], () => new Q(), 'question');

  ReactQuestionFactory.Instance.registerQuestion('slidergroup', (props) => {
    const q = props.question;
    ensureSliderGroupMidDefaults(q);
    return React.createElement(SliderGroupContent, {
      dimensions: q.dimensions || [],
      scaleMin: q.scaleMin ?? 1,
      scaleMax: q.scaleMax ?? 7,
      value: q.value,
      onChange: (v) => { q.value = v; },
      readOnly: q.isReadOnly,
      autoPersistDefaults: true,
    });
  });
}

export function registerPointAllocationWidget() {
  class Q extends Question {
    getType() { return 'pointallocation'; }
    onCheckForErrors(errors, isOnValueChanged) {
      super.onCheckForErrors(errors, isOnValueChanged);
      if (isOnValueChanged) return;
      // Align with image/media point allocation: full budget is not required.
      const budget = this.budget || 100;
      const val = this.value || {};
      const total = Object.values(val).reduce((s, n) => s + (Number(n) || 0), 0);
      if (total > budget) {
        errors.push(new CustomError(`Please allocate at most ${budget} points (currently ${total}).`, this));
      }
    }
  }
  Serializer.addClass('pointallocation', [
    { name: 'choices', default: [], category: 'general' },
    { name: 'budget:number', default: 100, category: 'general' },
  ], () => new Q(), 'question');

  ReactQuestionFactory.Instance.registerQuestion('pointallocation', (props) => {
    const q = props.question;
    return React.createElement(PointAllocationContent, {
      choices: q.choices || [],
      budget: q.budget || 100,
      value: q.value,
      onChange: (v) => { q.value = v; },
      readOnly: q.isReadOnly,
    });
  });
}

export function registerImageSliderGroupWidget() {
  class Q extends Question {
    getType() { return 'imageslidergroup'; }
    onCheckForErrors(errors, isOnValueChanged) {
      super.onCheckForErrors(errors, isOnValueChanged);
      if (!this.isRequired || isOnValueChanged) return;
      const dims = this.dimensions || [];
      const val = this.value || {};
      const missing = dims.filter((d) => val[d.id] === undefined || val[d.id] === null);
      if (missing.length) {
        errors.push(new CustomError('Please rate every dimension.', this));
      }
    }
  }
  Serializer.addClass('imageslidergroup', [
    ...MEDIA_PROPS,
    { name: 'imageHtml', category: 'general' },
    { name: 'imageLinks:string[]', category: 'general' },
    { name: 'imageNames:string[]', category: 'general' },
    { name: 'dimensions', default: [], category: 'general' },
    { name: 'scaleMin:number', default: 1, category: 'general' },
    { name: 'scaleMax:number', default: 7, category: 'general' },
  ], () => new Q(), 'question');

  function ImageSliderGroupQuestionComponent({ question: q, trialStimulusMedia = null }) {
    ensureSliderGroupMidDefaults(q);
    const fromTrial = resolveQuestionImageChoices(q, trialStimulusMedia)
      .map((c) => c.imageLink)
      .filter(Boolean);
    const urls = fromTrial.length ? fromTrial : (q.imageLinks?.length ? q.imageLinks : []);
    return React.createElement(ImageSliderGroupContent, {
      imageUrls: urls,
      dimensions: q.dimensions || [],
      scaleMin: q.scaleMin ?? 1,
      scaleMax: q.scaleMax ?? 7,
      value: q.value,
      onChange: (v) => { q.value = v; },
      readOnly: q.isReadOnly,
      autoPersistDefaults: true,
    });
  }
  registerTrialAwareQuestion('imageslidergroup', ImageSliderGroupQuestionComponent);
}

export function registerImagePointAllocationWidget() {
  class Q extends Question {
    getType() { return 'imagepointallocation'; }
    onCheckForErrors(errors, isOnValueChanged) {
      super.onCheckForErrors(errors, isOnValueChanged);
      if (isOnValueChanged) return;
      // Match mediapointallocation: do not require spending the full budget.
      // Only reject over-allocation.
      const budget = this.budget || 100;
      const val = this.value || {};
      const total = Object.values(val).reduce((s, n) => s + (Number(n) || 0), 0);
      if (total > budget) {
        errors.push(new CustomError(`Please allocate at most ${budget} points (currently ${total}).`, this));
      }
    }
  }
  Serializer.addClass('imagepointallocation', [
    ...MEDIA_PROPS,
    { name: 'imageHtml', category: 'general' },
    { name: 'imageLinks:string[]', category: 'general' },
    { name: 'imageNames:string[]', category: 'general' },
    { name: 'choices', default: [], category: 'general' },
    { name: 'budget:number', default: 100, category: 'general' },
  ], () => new Q(), 'question');

  function ImagePointAllocationQuestionComponent({ question: q, trialStimulusMedia = null }) {
    const fromTrial = resolveQuestionImageChoices(q, trialStimulusMedia)
      .map((c) => c.imageLink)
      .filter(Boolean);
    const urls = fromTrial.length ? fromTrial : (q.imageLinks?.length ? q.imageLinks : []);
    return React.createElement(ImagePointAllocationContent, {
      imageUrls: urls,
      choices: q.choices || [],
      budget: q.budget || 100,
      value: q.value,
      onChange: (v) => { q.value = v; },
      readOnly: q.isReadOnly,
    });
  }
  registerTrialAwareQuestion('imagepointallocation', ImagePointAllocationQuestionComponent);
}

// ── Skill question type ───────────────────────────────────────────────────────

export function registerSkillQuestionWidget() {
  Serializer.addClass('skillquestion', [
    { name: 'skillId', category: 'general' },
    { name: 'skillHtml', category: 'general' },
    { name: 'skillConfig', default: {}, category: 'general' },
    { name: 'skillImages', default: [], category: 'general' },
    { name: 'randomImageSelection:boolean', default: false, category: 'general' },
    { name: 'imageCount', default: 1, category: 'general' },
    { name: 'imageSelectionMode', default: 'huggingface_random', category: 'general' },
    { name: 'excludePreviouslyUsedImages:boolean', default: true, category: 'general' },
  ], () => new (class extends Question {
    getType() { return 'skillquestion'; }
  })(), 'question');

  ReactQuestionFactory.Instance.registerQuestion('skillquestion', (props) => {
    const q = props.question;
    const { config, images, value } = readSkillQuestionFields(q);
    return React.createElement(SkillQuestionFrame, {
      skillHtml: q.skillHtml || '',
      skillId: q.skillId || '',
      config,
      images,
      value,
      onChange: (v) => { q.value = v; },
    });
  });
}

/** Media Ranking — same drag-rank UI as Image Ranking, choices may be image/video/audio URLs. */
export function registerMediaRankingWidget() {
  const TYPE = 'mediaranking';
  if (Serializer.findClass(TYPE)) return;

  class MediaRankingQuestion extends Question {
    getType() { return TYPE; }
    getValueCore() {
      const val = super.getValueCore();
      return Array.isArray(val) ? val : [];
    }
    setValueCore(newValue) {
      if (ingestTrialsValue(this, newValue, (flat) => {
        super.setValueCore(Array.isArray(flat) ? flat : []);
      })) return;
      if (Array.isArray(newValue)) super.setValueCore(newValue);
    }
    isEmpty() {
      const n = getTrialCount(this);
      if (n > 1) return !allTrialsAnswered(getTrialsAnswer(this) || this.value, n);
      return super.isEmpty();
    }
  }

  Serializer.addClass(
    TYPE,
    [
      { name: 'choices:itemvalue[]', category: 'choices' },
      { name: 'imageCount:number', default: 4, category: 'general' },
      { name: 'imageSelectionMode', default: 'random', category: 'general' },
      { name: 'selectedImageUrls:string[]', category: 'general' },
      { name: 'randomImageSelection:boolean', default: false, category: 'general' },
      { name: 'mediaType', default: 'any', choices: ['any', 'image', 'video', 'audio'], category: 'general' },
      { name: 'imageFit', default: 'contain', category: 'general' },
      { name: 'excludePreviouslyUsedImages:boolean', default: true, category: 'general' },
      ...SLOT_PROPS,
      { name: 'mediaItems', default: [], category: 'general' },
      { name: 'mediaUrls:string[]', category: 'general' },
      { name: 'mediaNames:string[]', category: 'general' },
      { name: 'mediaTypes:string[]', category: 'general' },
    ],
    () => new MediaRankingQuestion(),
    'question',
  );

  function MediaRankingQuestionComponent({ question }) {
    return React.createElement(ImageRankingWidget, {
      question,
      value: question.value,
      onValueChanged: (v) => { question.value = v; },
    });
  }
  registerTrialAwareQuestion(TYPE, MediaRankingQuestionComponent);
}

/** Native SurveyJS imagepicker — wrap for multi-trial support. */
export function registerImagePickerTrialSupport() {
  ensureTrialCountProperty('imagepicker');
  function ImagePickerQuestionComponent({ question, ...rest }) {
    return React.createElement(SurveyQuestionImagePicker, { question, ...rest });
  }
  registerTrialAwareQuestion('imagepicker', ImagePickerQuestionComponent);
}

export function registerAllExtendedWidgets() {
  registerImageMatrixWidget();
  registerMediaDisplayWidget();
  registerMediaRatingWidget();
  registerMediaBooleanWidget();
  registerMediaRankingWidget();
  registerMediaPickerWidget();
  registerMediaMatrixWidget();
  registerMediaSliderGroupWidget();
  registerMediaPointAllocationWidget();
  registerImageAnnotationWidget();
  registerSliderGroupWidget();
  registerPointAllocationWidget();
  registerImageSliderGroupWidget();
  registerImagePointAllocationWidget();
  registerSkillQuestionWidget();
  registerMediaPairingProps();
  registerImagePickerTrialSupport();
}
