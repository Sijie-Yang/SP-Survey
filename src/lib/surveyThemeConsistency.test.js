import { applyAdminThemeToSurveyModel, buildSurveyHostStyle, generateCustomTheme } from './surveyStorage';

describe('survey theme consistency', () => {
  test('SurveyJS and its host canvas use the same configured colors', () => {
    const theme = {
      backgroundColor: '#101820',
      cardBackground: '#182630',
      textColor: '#f4f7f8',
      secondaryText: '#b4c2ca',
      borderColor: '#40515c',
      primaryColor: '#2ab7ca',
    };

    const surveyTheme = generateCustomTheme({ theme });
    const hostStyle = buildSurveyHostStyle(theme);

    expect(surveyTheme.cssVariables['--sjs-general-backcolor']).toBe(theme.backgroundColor);
    expect(surveyTheme.cssVariables['--sjs-general-forecolor']).toBe(theme.textColor);
    expect(hostStyle.backgroundColor).toBe(theme.backgroundColor);
    expect(hostStyle.color).toBe(theme.textColor);
    expect(hostStyle['--sp-survey-border']).toBe(theme.borderColor);
  });

  test('invalid host colors fall back to the same safe defaults', () => {
    const hostStyle = buildSurveyHostStyle({ backgroundColor: 'NaN', textColor: '' });

    expect(hostStyle.backgroundColor).toBe('#ffffff');
    expect(hostStyle.color).toBe('#212121');
  });

  test('legacy project configs use the defaults displayed by Theme Settings', () => {
    const model = { applyTheme: jest.fn() };

    applyAdminThemeToSurveyModel(model, { title: 'Legacy project without theme' });

    expect(model.applyTheme).toHaveBeenCalledTimes(1);
    expect(model.applyTheme.mock.calls[0][0].cssVariables['--sjs-primary-backcolor']).toBe('#1976d2');
    expect(model.applyTheme.mock.calls[0][0].cssVariables['--sjs-general-forecolor']).toBe('#212121');
  });
});
