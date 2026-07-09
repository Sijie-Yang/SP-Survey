import React from 'react';
import { ReactQuestionFactory } from 'survey-react-ui';
import { Serializer, Question, CustomError } from 'survey-core';
import ImageRankingWidget from './ImageRankingWidget';
import ImageRatingWidget from './ImageRatingWidget';
import ImageBooleanWidget from './ImageBooleanWidget';
import { MediaDisplayContent, MediaRatingContent, MediaBooleanContent } from './MediaWidgets';
import { SliderGroupContent, PointAllocationContent, ImageSliderGroupContent, ImagePointAllocationContent } from './ResponseWidgets';
import ImageAnnotationCanvas from './ImageAnnotationWidget';
import SkillQuestionFrame from './SkillQuestionWidget';
import { readSkillQuestionFields } from '../lib/skillPostMessage';
import { inferMediaType } from '../lib/mediaUtils';
import { resolveQuestionMediaItems } from '../lib/surveyMediaInjection';

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

  // Register the React component
  ReactQuestionFactory.Instance.registerQuestion(WIDGET_NAME, (props) => {
    console.log('ImageRanking component factory called with props:', props);
    return React.createElement(ImageRankingQuestionComponent, props);
  });
  
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
    if (Array.isArray(newValue)) {
      super.setValueCore(newValue);
    }
  }
}

// React Component Wrapper
function ImageRankingQuestionComponent(props) {
  const { question } = props;

  console.log('ImageRankingQuestionComponent - props:', props);
  console.log('ImageRankingQuestionComponent - question:', question);
  console.log('ImageRankingQuestionComponent - question.choices:', question.choices);

  const handleValueChange = (newValue) => {
    console.log('ImageRankingQuestionComponent - handleValueChange:', newValue);
    question.value = newValue;
  };

  // Simple test rendering first
  if (!question.choices || question.choices.length === 0) {
    return (
      <div style={{ padding: '20px', border: '1px solid #ccc', backgroundColor: '#f9f9f9' }}>
        <p>Image Ranking Component Loaded</p>
        <p>No choices available yet. Choices: {JSON.stringify(question.choices)}</p>
        <p>Question type: {question.getType()}</p>
      </div>
    );
  }

  // Return only the widget content, let SurveyJS handle the question wrapper, title, and description
  return (
    <ImageRankingWidget
      question={question}
      value={question.value}
      onValueChanged={handleValueChange}
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
    ],
    function () {
      return new ImageRatingQuestion();
    },
    'question'
  );

  // Register the React component
  ReactQuestionFactory.Instance.registerQuestion(RATING_WIDGET_NAME, (props) => {
    console.log('ImageRating component factory called with props:', props);
    return React.createElement(ImageRatingQuestionComponent, props);
  });
  
  console.log('ImageRating widget registered successfully');
}

// Custom Question Class for Image Rating
class ImageRatingQuestion extends Question {
  getType() {
    return 'imagerating';
  }

  // Ensure the value is a number (rating value)
  getValueCore() {
    const val = super.getValueCore();
    return typeof val === 'number' ? val : null;
  }

  setValueCore(newValue) {
    if (typeof newValue === 'number' || newValue === null) {
      super.setValueCore(newValue);
    }
  }
}

// React Component Wrapper for Image Rating
function ImageRatingQuestionComponent(props) {
  const { question } = props;

  console.log('ImageRatingQuestionComponent - props:', props);
  console.log('ImageRatingQuestionComponent - question:', question);
  console.log('ImageRatingQuestionComponent - question.choices:', question.choices);

  const handleValueChange = (newValue) => {
    console.log('ImageRatingQuestionComponent - handleValueChange:', newValue);
    question.value = newValue;
  };

  // Simple test rendering first
  if (!question.choices || question.choices.length === 0) {
    return (
      <div style={{ padding: '20px', border: '1px solid #ccc', backgroundColor: '#f9f9f9' }}>
        <p>Image Rating Component Loaded</p>
        <p>No choices available yet. Choices: {JSON.stringify(question.choices)}</p>
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
    />
  );
}

// Register Image Boolean Widget
export function registerImageBooleanWidget() {
  console.log('Registering ImageBoolean widget...');
  
  const BOOLEAN_WIDGET_NAME = 'imageboolean';
  
  // First, add imageLink property to ItemValue (if not already added)
  Serializer.addProperty('itemvalue', {
    name: 'imageLink',
    category: 'general'
  });
  
  console.log('Added imageLink property to itemvalue for boolean');

  // Add custom properties to the serializer - inherit from boolean
  Serializer.addClass(
    BOOLEAN_WIDGET_NAME,
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
        name: 'imageSource',
        default: 'huggingface',
        category: 'general',
      },
      {
        name: 'huggingFaceConfig:object',
        category: 'general',
      },
    ],
    function () {
      return new ImageBooleanQuestion();
    },
    'boolean'  // ✅ Inherit from boolean instead of question
  );

  // Register the React component
  ReactQuestionFactory.Instance.registerQuestion(BOOLEAN_WIDGET_NAME, (props) => {
    console.log('ImageBoolean component factory called with props:', props);
    return React.createElement(ImageBooleanQuestionComponent, props);
  });
  
  console.log('ImageBoolean widget registered successfully');
}

// Custom Question Class for Image Boolean
class ImageBooleanQuestion extends Question {
  getType() {
    return 'imageboolean';
  }

  // Ensure the value is a boolean
  getValueCore() {
    const val = super.getValueCore();
    return typeof val === 'boolean' ? val : null;
  }

  setValueCore(newValue) {
    if (typeof newValue === 'boolean' || newValue === null) {
      super.setValueCore(newValue);
    }
  }
}

// React Component Wrapper for Image Boolean
function ImageBooleanQuestionComponent(props) {
  const { question } = props;

  console.log('ImageBooleanQuestionComponent - props:', props);
  console.log('ImageBooleanQuestionComponent - question:', question);
  console.log('ImageBooleanQuestionComponent - question.choices:', question.choices);

  const handleValueChange = (newValue) => {
    console.log('ImageBooleanQuestionComponent - handleValueChange:', newValue);
    question.value = newValue;
  };

  // Simple test rendering first
  if (!question.choices || question.choices.length === 0) {
    return (
      <div style={{ padding: '20px', border: '1px solid #ccc', backgroundColor: '#f9f9f9' }}>
        <p>Image Boolean Component Loaded</p>
        <p>No choices available yet. Choices: {JSON.stringify(question.choices)}</p>
        <p>Question type: {question.getType()}</p>
      </div>
    );
  }

  // Return only the widget content, let SurveyJS handle the question wrapper, title, and description
  return (
    <ImageBooleanWidget
      question={question}
      value={question.value}
      onValueChanged={handleValueChange}
    />
  );
}

// ===== IMAGE MATRIX REGISTRATION =====
export function registerImageMatrixWidget() {
  console.log('🎨 Registering ImageMatrix widget...');

  const WIDGET_NAME_MATRIX = 'imagematrix';

  // Add custom properties for image handling
  // Note: rows and columns are inherited from matrix, we only add image-specific properties
  Serializer.addClass(
    WIDGET_NAME_MATRIX,
    [
      {
        name: 'imageLinks:string[]',
        category: 'general',
        default: []
      },
      {
        name: 'imageCount:number',
        default: 1,
        category: 'general',
      },
      {
        name: 'imageSelectionMode',
        default: 'huggingface_random',
        category: 'general',
      },
      {
        name: 'selectedImageUrls:string[]',
        category: 'general',
        default: []
      },
      {
        name: 'randomImageSelection:boolean',
        default: false,
        category: 'general',
      },
      {
        name: 'imageFit',
        default: 'cover',
        category: 'general',
      },
      {
        name: 'imageSource',
        default: 'huggingface',
        category: 'general',
      },
      {
        name: 'huggingFaceConfig:object',
        category: 'general',
      },
    ],
    function () {
      return new ImageMatrixQuestion('');
    },
    'matrix'  // ✅ Inherit from matrix to get rows and columns support
  );

  console.log('✅ ImageMatrix class added to Serializer (inherits from matrix)');

  // Register React component
  ReactQuestionFactory.Instance.registerQuestion(WIDGET_NAME_MATRIX, (props) => {
    console.log('🎨 Rendering ImageMatrix component with props:', props);
    return React.createElement(ImageMatrixQuestionComponent, props);
  });

  console.log('✅ ImageMatrix widget registered successfully');
}

// Custom Question Class for Image Matrix (inherits from matrix)
class ImageMatrixQuestion extends Question {
  getType() {
    return 'imagematrix';
  }
  
  // rows and columns are inherited from matrix, no need to override
}

// React Component for Image Matrix
function ImageMatrixQuestionComponent(props) {
  const { question } = props;

  // Get data from question (inherited from matrix)
  const images = question.imageLinks || [];
  const rows = question.rows || [];
  const columns = question.columns || [];

  console.log('📸 ImageMatrix render - images:', images.length, 'rows:', rows.length, 'columns:', columns.length);

  // Handle value change
  const handleCellClick = (rowValue, columnValue) => {
    const currentValue = question.value || {};
    question.value = {
      ...currentValue,
      [rowValue]: columnValue
    };
  };

  return (
    <div style={{ width: '100%' }}>
      {/* Display Images — justified gallery, see src/lib/imagePickerLayout.js */}
      {images.length > 0 && (
        <div
          className="sp-image-gallery"
          style={{
            marginBottom: '24px',
            padding: '16px',
            backgroundColor: '#f5f5f5',
            borderRadius: '8px',
            boxSizing: 'border-box',
          }}
        >
          {images.map((imageUrl, index) => (
            <div
              key={index}
              className="sp-image-gallery__item"
              style={{
                borderRadius: '8px',
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
      )}

      {/* Matrix Table */}
      {rows.length > 0 && columns.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{
            width: '100%',
            borderCollapse: 'collapse',
            backgroundColor: 'white',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            borderRadius: '8px',
            overflow: 'hidden'
          }}>
            <thead>
              <tr style={{ backgroundColor: '#f8f9fa' }}>
                <th style={{
                  padding: '12px',
                  textAlign: 'left',
                  borderBottom: '2px solid #dee2e6',
                  fontWeight: '600'
                }}>
                  {/* Empty cell for row headers */}
                </th>
                {columns.map((col, index) => (
                  <th key={index} style={{
                    padding: '12px',
                    textAlign: 'center',
                    borderBottom: '2px solid #dee2e6',
                    fontWeight: '600',
                    minWidth: '100px'
                  }}>
                    {typeof col === 'object' ? col.text : col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => {
                const rowValue = typeof row === 'object' ? row.value : row;
                const rowText = typeof row === 'object' ? row.text : row;
                const currentValue = question.value || {};

                return (
                  <tr key={rowIndex} style={{
                    borderBottom: rowIndex < rows.length - 1 ? '1px solid #dee2e6' : 'none'
                  }}>
                    <td style={{
                      padding: '12px',
                      fontWeight: '500',
                      backgroundColor: '#f8f9fa'
                    }}>
                      {rowText}
                    </td>
                    {columns.map((col, colIndex) => {
                      const colValue = typeof col === 'object' ? col.value : col;
                      const isSelected = currentValue[rowValue] === colValue;

                      return (
                        <td key={colIndex} style={{
                          padding: '8px',
                          textAlign: 'center'
                        }}>
                          <input
                            type="radio"
                            name={`matrix_${rowValue}`}
                            checked={isSelected}
                            onChange={() => handleCellClick(rowValue, colValue)}
                            style={{
                              width: '20px',
                              height: '20px',
                              cursor: 'pointer'
                            }}
                          />
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* No configuration message */}
      {(rows.length === 0 || columns.length === 0) && (
        <div style={{
          padding: '20px',
          textAlign: 'center',
          backgroundColor: '#f9f9f9',
          border: '1px dashed #ccc',
          borderRadius: '8px'
        }}>
          <p style={{ margin: 0, color: '#666' }}>
            {rows.length === 0 && 'No rows configured. '}
            {columns.length === 0 && 'No columns configured. '}
            Please configure the matrix in the editor.
          </p>
        </div>
      )}
    </div>
  );
}

// Export default registration function
export default registerImageRankingWidget;

// ── Media question types ──────────────────────────────────────────────────────

const MEDIA_PAIRING_TYPES = [
  'imagepicker', 'imageranking', 'imagerating', 'imageboolean', 'image', 'imagematrix',
  'mediadisplay', 'mediarating', 'mediaboolean', 'imageannotation', 'skillquestion',
  'imageslidergroup', 'imagepointallocation',
];

export function registerMediaPairingProps() {
  MEDIA_PAIRING_TYPES.forEach((typeName) => {
    Serializer.addProperty(typeName, {
      name: 'mediaAssignmentMode',
      default: 'individual',
      choices: ['individual', 'group', 'category'],
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
];

function makeMediaQuestion(typeName, parent = 'question') {
  class Q extends Question {
    getType() { return typeName; }
  }
  Serializer.addClass(typeName, MEDIA_PROPS, () => new Q(), parent);
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
  ReactQuestionFactory.Instance.registerQuestion('mediadisplay', (props) => {
    const q = props.question;
    const items = resolveQuestionMediaItems(q);
    const first = items[0];
    const url = first?.url || q.mediaUrl || '';
    const type = first?.type
      || (q.mediaType === 'any' ? inferMediaType(url) : (q.mediaType || inferMediaType(url)));
    return React.createElement(MediaDisplayContent, {
      mediaUrl: url,
      mediaType: type,
      mediaName: first?.name || q.mediaName,
      mediaItems: items.length ? items : null,
      displayMode: q.displayMode || 'single',
      exposureSeconds: q.exposureSeconds || 5,
      beforeLabel: q.beforeLabel || 'Before',
      afterLabel: q.afterLabel || 'After',
    });
  });
}

export function registerMediaRatingWidget() {
  makeMediaQuestion('mediarating');
  Serializer.addProperty('mediarating', { name: 'rateMin:number', default: 1, category: 'general' });
  Serializer.addProperty('mediarating', { name: 'rateMax:number', default: 5, category: 'general' });
  Serializer.addProperty('mediarating', { name: 'mediaItems', default: [], category: 'general' });
  Serializer.addProperty('mediarating', { name: 'mediaUrls:string[]', category: 'general' });
  Serializer.addProperty('mediarating', { name: 'mediaNames:string[]', category: 'general' });
  Serializer.addProperty('mediarating', { name: 'mediaTypes:string[]', category: 'general' });
  ReactQuestionFactory.Instance.registerQuestion('mediarating', (props) => {
    const q = props.question;
    const items = resolveQuestionMediaItems(q);
    const first = items[0];
    const url = first?.url || q.mediaUrl || '';
    const type = first?.type
      || (q.mediaType === 'any' ? inferMediaType(url) : (q.mediaType || inferMediaType(url)));
    return React.createElement(MediaRatingContent, {
      mediaUrl: url, mediaType: type, mediaName: first?.name || q.mediaName, mediaItems: items.length ? items : null,
      value: q.value, rateMin: q.rateMin || 1, rateMax: q.rateMax || 5,
      onChange: (v) => q.value = v,
    });
  });
}

export function registerMediaBooleanWidget() {
  makeMediaQuestion('mediaboolean', 'boolean');
  Serializer.addProperty('mediaboolean', { name: 'mediaItems', default: [], category: 'general' });
  Serializer.addProperty('mediaboolean', { name: 'mediaUrls:string[]', category: 'general' });
  Serializer.addProperty('mediaboolean', { name: 'mediaNames:string[]', category: 'general' });
  Serializer.addProperty('mediaboolean', { name: 'mediaTypes:string[]', category: 'general' });
  ReactQuestionFactory.Instance.registerQuestion('mediaboolean', (props) => {
    const q = props.question;
    const items = resolveQuestionMediaItems(q);
    const first = items[0];
    const url = first?.url || q.mediaUrl || '';
    const type = first?.type
      || (q.mediaType === 'any' ? inferMediaType(url) : (q.mediaType || inferMediaType(url)));
    return React.createElement(MediaBooleanContent, {
      mediaUrl: url, mediaType: type, mediaName: first?.name || q.mediaName, mediaItems: items.length ? items : null,
      value: q.value, labelTrue: q.labelTrue || 'Yes', labelFalse: q.labelFalse || 'No',
      onChange: (v) => q.value = v,
    });
  });
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
    { name: 'allowedTools', default: ['point', 'line', 'region'], category: 'general' },
    { name: 'minAnnotations:number', default: 0, category: 'general' },
    { name: 'maxAnnotations:number', default: 50, category: 'general' },
  ], () => new QuestionModel(), 'question');

  ReactQuestionFactory.Instance.registerQuestion('imageannotation', (props) => {
    const q = props.question;
    const url = q.annotationImageUrl || q.mediaUrl || '';
    return React.createElement(ImageAnnotationCanvas, {
      imageUrl: url,
      value: q.value,
      allowedTools: q.allowedTools || ['point', 'line', 'region'],
      minAnnotations: q.minAnnotations || 0,
      maxAnnotations: q.maxAnnotations ?? 50,
      onChange: (v) => { q.value = v; },
    });
  });
}

// ── Native response types (slider group / point allocation) ──────────────────

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
    return React.createElement(SliderGroupContent, {
      dimensions: q.dimensions || [],
      scaleMin: q.scaleMin ?? 1,
      scaleMax: q.scaleMax ?? 7,
      value: q.value,
      onChange: (v) => { q.value = v; },
      readOnly: q.isReadOnly,
    });
  });
}

export function registerPointAllocationWidget() {
  class Q extends Question {
    getType() { return 'pointallocation'; }
    onCheckForErrors(errors, isOnValueChanged) {
      super.onCheckForErrors(errors, isOnValueChanged);
      if (isOnValueChanged) return;
      const budget = this.budget || 100;
      const val = this.value || {};
      const total = Object.values(val).reduce((s, n) => s + (Number(n) || 0), 0);
      if (this.isRequired && total !== budget) {
        errors.push(new CustomError(`Please allocate exactly ${budget} points (currently ${total}).`, this));
      } else if (!this.isRequired && total > budget) {
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

  ReactQuestionFactory.Instance.registerQuestion('imageslidergroup', (props) => {
    const q = props.question;
    const urls = q.imageLinks?.length ? q.imageLinks : [];
    return React.createElement(ImageSliderGroupContent, {
      imageUrls: urls,
      dimensions: q.dimensions || [],
      scaleMin: q.scaleMin ?? 1,
      scaleMax: q.scaleMax ?? 7,
      value: q.value,
      onChange: (v) => { q.value = v; },
      readOnly: q.isReadOnly,
    });
  });
}

export function registerImagePointAllocationWidget() {
  class Q extends Question {
    getType() { return 'imagepointallocation'; }
    onCheckForErrors(errors, isOnValueChanged) {
      super.onCheckForErrors(errors, isOnValueChanged);
      if (isOnValueChanged) return;
      const budget = this.budget || 100;
      const val = this.value || {};
      const total = Object.values(val).reduce((s, n) => s + (Number(n) || 0), 0);
      if (this.isRequired && total !== budget) {
        errors.push(new CustomError(`Please allocate exactly ${budget} points (currently ${total}).`, this));
      } else if (!this.isRequired && total > budget) {
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

  ReactQuestionFactory.Instance.registerQuestion('imagepointallocation', (props) => {
    const q = props.question;
    const urls = q.imageLinks?.length ? q.imageLinks : [];
    return React.createElement(ImagePointAllocationContent, {
      imageUrls: urls,
      choices: q.choices || [],
      budget: q.budget || 100,
      value: q.value,
      onChange: (v) => { q.value = v; },
      readOnly: q.isReadOnly,
    });
  });
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

export function registerAllExtendedWidgets() {
  registerMediaDisplayWidget();
  registerMediaRatingWidget();
  registerMediaBooleanWidget();
  registerImageAnnotationWidget();
  registerSliderGroupWidget();
  registerPointAllocationWidget();
  registerImageSliderGroupWidget();
  registerImagePointAllocationWidget();
  registerSkillQuestionWidget();
  registerMediaPairingProps();
}
