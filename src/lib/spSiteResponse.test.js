import { SP_SITE_SDK_SOURCE } from './spSite';

// responseParts lives inside the SDK source that runs in the page.
const responseParts = new Function(`${SP_SITE_SDK_SOURCE.match(/function responseParts\(r\) \{[\s\S]*?\n {2}\}/)[0]}; return responseParts;`)();

test('an adapter body that is an object is sent as JSON, not "[object Object]"', () => {
  expect(responseParts({ body: { a: 1 } }).body).toBe('{"a":1}');
  expect(responseParts({ status: 400, json: { e: 1 } })).toMatchObject({ status: 400, body: '{"e":1}' });
});

test('page data with its own "status" field is data, not a response wrapper', () => {
  expect(responseParts({ status: 'in_progress', answers: {} })).toMatchObject({ status: 200, body: '{"status":"in_progress","answers":{}}' });
});
