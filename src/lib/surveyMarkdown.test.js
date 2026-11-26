import { Model } from 'survey-core';
import { applySurveyLocale } from './surveyLocale';
import { descriptionMarkdownToHtml } from './surveyMarkdown';

describe('question description markdown', () => {
  test('turns blank lines, bold and lists into html and escapes markup', () => {
    const html = descriptionMarkdownToHtml('**Imageability** is distinct.\n\n- Enclosure\n- Human scale\n\n<script>alert(1)</script>');
    expect(html).toBe('<p><strong>Imageability</strong> is distinct.</p>\n<ul>\n<li>Enclosure</li>\n<li>Human scale</li>\n</ul>\n&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  test('a plain sentence stays one paragraph', () => {
    expect(descriptionMarkdownToHtml('Watch the clip, then rate it.')).toBe('<p>Watch the clip, then rate it.</p>');
  });

  test('survey descriptions opt into markdown; titles stay researcher text', () => {
    const model = new Model({
      description: '**Study** introduction.',
      elements: [{
        type: 'text',
        name: 'q',
        title: '**not bold**',
        description: '**Imageability** is one.\n\n**Enclosure** is two.',
      }],
    });
    applySurveyLocale(model, {});
    const question = model.getQuestionByName('q');
    expect(question.locDescription.useMarkdown).toBe(true);
    expect(question.locDescription.hasHtmlValue()).toBe(true);
    expect(question.locDescription.getHtmlValue()).toBe('<p><strong>Imageability</strong> is one.</p>\n<p><strong>Enclosure</strong> is two.</p>');
    expect(question.locTitle.hasHtmlValue()).toBe(false);
    expect(model.locDescription.hasHtmlValue()).toBe(true);
    expect(model.locDescription.getHtmlValue()).toBe('<p><strong>Study</strong> introduction.</p>');
  });
});


test('supports structured Markdown and blocks executable HTML and unsafe links', () => {
  const html = descriptionMarkdownToHtml('### Instructions\n\n> Read *carefully*\n\n1. First\n2. Second\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```js\nconst a = "<tag>";\n```\n\n[unsafe](javascript:alert%281%29)\n\n<img src=x onerror=alert(1)>');
  expect(html).toContain('<h3>Instructions</h3>');
  expect(html).toContain('<blockquote>');
  expect(html).toContain('<em>carefully</em>');
  expect(html).toContain('<ol>');
  expect(html).toContain('<table>');
  expect(html).toContain('<pre><code class="language-js">');
  expect(html).toContain('&lt;tag&gt;');
  expect(html).not.toContain('href="javascript:');
  expect(html).not.toContain('<img');
});
