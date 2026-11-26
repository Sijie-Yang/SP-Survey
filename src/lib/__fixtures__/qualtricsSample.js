// A small but structurally faithful Qualtrics export (.qsf), hand-written for tests.
export const QUALTRICS_SAMPLE = {
  SurveyEntry: { SurveyID: 'SV_test', SurveyName: 'Street perception pilot', SurveyDescription: '<p>Pilot &amp; test</p>', SurveyLanguage: 'EN' },
  SurveyElements: [
    {
      SurveyID: 'SV_test', Element: 'BL', PrimaryAttribute: 'Survey Blocks',
      Payload: {
        0: { Type: 'Default', Description: 'Intro', ID: 'BL_intro', BlockElements: [{ Type: 'Question', QuestionID: 'QID1' }, { Type: 'Question', QuestionID: 'QID2' }, { Type: 'Page Break' }, { Type: 'Question', QuestionID: 'QID3' }] },
        1: { Type: 'Standard', Description: 'Scales', ID: 'BL_scales', BlockElements: [{ Type: 'Question', QuestionID: 'QID4' }, { Type: 'Question', QuestionID: 'QID5' }, { Type: 'Question', QuestionID: 'QID6' }, { Type: 'Question', QuestionID: 'QID7' }] },
        2: { Type: 'Standard', Description: 'About you', ID: 'BL_about', BlockElements: [{ Type: 'Question', QuestionID: 'QID8' }, { Type: 'Question', QuestionID: 'QID9' }, { Type: 'Question', QuestionID: 'QID10' }, { Type: 'Question', QuestionID: 'QID11' }, { Type: 'Question', QuestionID: 'QID12' }, { Type: 'Question', QuestionID: 'QID13' }] },
        3: { Type: 'Trash', Description: 'Trash / Unused Questions', ID: 'BL_trash', BlockElements: [{ Type: 'Question', QuestionID: 'QID99' }] },
      },
    },
    {
      SurveyID: 'SV_test', Element: 'FL', PrimaryAttribute: 'Survey Flow',
      Payload: { Type: 'Root', FlowID: 'FL_1', Flow: [
        { Type: 'EmbeddedData', FlowID: 'FL_2', EmbeddedData: [{ Field: 'source' }] },
        { Type: 'Block', ID: 'BL_intro', FlowID: 'FL_3' },
        { Type: 'BlockRandomizer', FlowID: 'FL_4', SubSet: 1, Flow: [{ Type: 'Standard', ID: 'BL_scales', FlowID: 'FL_5' }] },
        { Type: 'Standard', ID: 'BL_about', FlowID: 'FL_6' },
      ] },
    },
    { Element: 'SQ', PrimaryAttribute: 'QID1', Payload: { QuestionID: 'QID1', DataExportTag: 'intro', QuestionType: 'DB', Selector: 'TB', QuestionText: '<p>Welcome!<br>This takes <b>5 minutes</b>.</p><img src="https://x.qualtrics.com/logo.png">' } },
    { Element: 'SQ', PrimaryAttribute: 'QID2', Payload: { QuestionID: 'QID2', DataExportTag: 'Q2', QuestionType: 'MC', Selector: 'SAVR', SubSelector: 'TX', QuestionText: 'Do you consent?', Choices: { 1: { Display: 'Yes' }, 2: { Display: 'No' } }, ChoiceOrder: [1, 2], Validation: { Settings: { ForceResponse: 'ON', Type: 'None' } } } },
    { Element: 'SQ', PrimaryAttribute: 'QID3', Payload: { QuestionID: 'QID3', DataExportTag: 'walk_freq', QuestionType: 'MC', Selector: 'MAVR', QuestionText: 'How do you travel? (select all)', Choices: { 1: { Display: 'Walk' }, 2: { Display: 'Bike' }, 3: { Display: 'Other', TextEntry: 'true' } }, ChoiceOrder: ['1', '2', '3'], Randomization: { Type: 'All' } } },
    { Element: 'SQ', PrimaryAttribute: 'QID4', Payload: { QuestionID: 'QID4', DataExportTag: 'safety_matrix', QuestionType: 'Matrix', Selector: 'Likert', SubSelector: 'SingleAnswer', QuestionText: 'Rate your street', Choices: { 1: { Display: 'Safe' }, 2: { Display: 'Green' } }, ChoiceOrder: [1, 2], Answers: { 1: { Display: 'Disagree' }, 2: { Display: 'Neutral' }, 3: { Display: 'Agree' } }, AnswerOrder: [1, 2, 3], RecodeValues: { 1: '-1', 2: '0', 3: '1' }, DisplayLogic: { 0: {} } } },
    { Element: 'SQ', PrimaryAttribute: 'QID5', Payload: { QuestionID: 'QID5', DataExportTag: 'feel', QuestionType: 'Slider', Selector: 'HSLIDER', QuestionText: 'How does the street feel?', Choices: { 1: { Display: 'Calm' }, 2: { Display: 'Lively' } }, ChoiceOrder: [1, 2], Configuration: { CSSliderMin: 0, CSSliderMax: 10 }, Labels: { 1: { Display: 'Not at all' }, 2: { Display: 'Very' } } } },
    { Element: 'SQ', PrimaryAttribute: 'QID6', Payload: { QuestionID: 'QID6', DataExportTag: 'rank', QuestionType: 'RO', Selector: 'DND', QuestionText: 'Rank these', Choices: { 1: { Display: 'Trees' }, 2: { Display: 'Benches' }, 3: { Display: 'Lights' } } } },
    { Element: 'SQ', PrimaryAttribute: 'QID7', Payload: { QuestionID: 'QID7', DataExportTag: 'heat', QuestionType: 'HeatMap', Selector: 'OnePoint', QuestionText: 'Click where you feel unsafe' } },
    { Element: 'SQ', PrimaryAttribute: 'QID8', Payload: { QuestionID: 'QID8', DataExportTag: 'age', QuestionType: 'TE', Selector: 'SL', QuestionText: 'Age', Validation: { Settings: { ContentType: 'ValidNumber' } } } },
    { Element: 'SQ', PrimaryAttribute: 'QID9', Payload: { QuestionID: 'QID9', DataExportTag: 'comments', QuestionType: 'TE', Selector: 'ML', QuestionText: 'Comments on ${q://QID3/ChoiceGroup/SelectedChoices}' } },
    { Element: 'SQ', PrimaryAttribute: 'QID10', Payload: { QuestionID: 'QID10', DataExportTag: 'nps', QuestionType: 'MC', Selector: 'NPS', QuestionText: 'Recommend this street?' } },
    { Element: 'SQ', PrimaryAttribute: 'QID11', Payload: { QuestionID: 'QID11', DataExportTag: 'country', QuestionType: 'MC', Selector: 'DL', QuestionText: 'Country', Choices: { 1: { Display: 'Singapore' }, 2: { Display: 'China' } } } },
    { Element: 'SQ', PrimaryAttribute: 'QID12', Payload: { QuestionID: 'QID12', DataExportTag: 'budget', QuestionType: 'CS', Selector: 'VRTL', QuestionText: 'Split 100 dollars', Choices: { 1: { Display: 'Trees' }, 2: { Display: 'Roads' } }, Validation: { Settings: { ChoiceTotal: 100 } } } },
    { Element: 'SQ', PrimaryAttribute: 'QID13', Payload: { QuestionID: 'QID13', DataExportTag: 'contact', QuestionType: 'TE', Selector: 'FORM', QuestionText: 'Contact', Choices: { 1: { Display: 'Name' }, 2: { Display: 'City' } } } },
    { Element: 'SQ', PrimaryAttribute: 'QID99', Payload: { QuestionID: 'QID99', DataExportTag: 'old', QuestionType: 'TE', Selector: 'SL', QuestionText: 'Deleted' } },
    { Element: 'QO', PrimaryAttribute: 'QO_1', Payload: {} },
  ],
};
