import {
  ENTITY_SCHEMAS,
  OPERATION_CONTRACT_SCHEMA,
  OPERATION_ITEM_SCHEMA,
  OPERATION_TYPES,
  PLATFORM_SCHEMA,
  PLATFORM_SCHEMA_HASH,
  QUESTION_TYPE_IDS,
  SURVEY_CONFIG_SCHEMA,
} from './generated.js';

export {
  ENTITY_SCHEMAS,
  OPERATION_CONTRACT_SCHEMA,
  OPERATION_ITEM_SCHEMA,
  OPERATION_TYPES,
  PLATFORM_SCHEMA,
  PLATFORM_SCHEMA_HASH,
  QUESTION_TYPE_IDS,
  SURVEY_CONFIG_SCHEMA,
};

export function getQuestionTypeDefinition(type) {
  return PLATFORM_SCHEMA.questionTypes[type] || null;
}

export function isKnownQuestionType(type) {
  return Object.prototype.hasOwnProperty.call(PLATFORM_SCHEMA.questionTypes, type);
}

export function questionHasTrait(type, trait) {
  return getQuestionTypeDefinition(type)?.traits?.includes(trait) || false;
}

export function getQuestionFieldNames(type) {
  return [...(getQuestionTypeDefinition(type)?.allFields || [])];
}

export function getQuestionFieldDefinitions(type) {
  return Object.fromEntries(
    getQuestionFieldNames(type).map((field) => [field, PLATFORM_SCHEMA.questionFields[field]]),
  );
}

export function getQuestionJsonSchema(type) {
  const definition = getQuestionTypeDefinition(type);
  if (!definition) return null;
  return {
    type: 'object',
    properties: {
      ...getQuestionFieldDefinitions(type),
      type: { type: 'string', enum: [type] },
    },
    required: ['type', 'name'],
    additionalProperties: true,
  };
}

export function getEntitySchema(entity) {
  return ENTITY_SCHEMAS[entity] || null;
}

export function getOperationContract(operation) {
  return PLATFORM_SCHEMA.operationContracts[operation] || null;
}
