import React from 'react';

/** Normalize SurveyJS ItemValue / plain row-column entries. */
export function normalizeMatrixAxis(items) {
  if (!items) return [];
  const arr = typeof items.toArray === 'function' ? items.toArray() : (Array.isArray(items) ? items : []);
  return arr.map((item, index) => {
    if (item == null) return { value: `item_${index}`, text: `Item ${index + 1}` };
    if (typeof item === 'string' || typeof item === 'number') {
      return { value: String(item), text: String(item) };
    }
    const value = item.value ?? item.name ?? `item_${index}`;
    const text = item.text ?? item.title ?? String(value);
    return { value, text };
  });
}

/**
 * SurveyJS defaultV2 radio matrix look (same classes as native type:matrix).
 * Embedding SurveyQuestionMatrix on a custom question type does not paint reliably.
 */
export default function SurveyJsMatrixControl({
  name = 'matrix',
  rows = [],
  columns = [],
  value,
  onChange,
  disabled = false,
}) {
  const rowItems = normalizeMatrixAxis(rows);
  const colItems = normalizeMatrixAxis(columns);
  const current = value && typeof value === 'object' && !Array.isArray(value) ? value : {};

  if (!rowItems.length || !colItems.length) {
    return (
      <div style={{
        padding: 20,
        textAlign: 'center',
        backgroundColor: '#f9f9f9',
        border: '1px dashed #ccc',
        borderRadius: 8,
      }}
      >
        Please configure matrix rows and columns in the editor.
      </div>
    );
  }

  const setCell = (rowValue, columnValue) => {
    if (disabled) return;
    onChange?.({ ...current, [rowValue]: columnValue });
  };

  return (
    <div className="sd-matrix sd-table-wrapper sp-surveyjs-matrix">
      <fieldset>
        <table className="sd-table sd-matrix__table sd-table--align-middle">
          <thead>
            <tr>
              <td />
              {colItems.map((col) => (
                <th
                  key={String(col.value)}
                  className="sd-table__cell sd-table__cell--header"
                >
                  {/* SurveyJS sets header font-size:0 and only restores it on span children */}
                  <span>{col.text}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowItems.map((row) => {
              const selected = current[row.value];
              return (
                <tr key={String(row.value)} className="sd-table__row">
                  <td className="sd-table__cell sd-table__cell--row-text">
                    {row.text}
                  </td>
                  {colItems.map((col, colIndex) => {
                    const isChecked = selected === col.value
                      || String(selected) === String(col.value);
                    const inputId = `${name}_${row.value}_${colIndex}`;
                    return (
                      <td
                        key={String(col.value)}
                        className="sd-table__cell sd-matrix__cell"
                        data-responsive-title={col.text}
                      >
                        <label
                          className={[
                            'sd-item',
                            'sd-radio',
                            'sd-matrix__label',
                            !disabled ? 'sd-radio--allowhover' : '',
                            isChecked ? 'sd-radio--checked sd-item--checked' : '',
                          ].filter(Boolean).join(' ')}
                        >
                          <input
                            id={inputId}
                            type="radio"
                            className="sd-visuallyhidden sd-item__control sd-radio__control"
                            name={`${name}_${row.value}`}
                            value={col.value}
                            checked={isChecked}
                            disabled={disabled}
                            onChange={() => setCell(row.value, col.value)}
                          />
                          <span className="sd-item__decorator sd-radio__decorator" />
                          {/* SurveyJS mobile hides thead; ::before is disabled on
                              .sd-matrix__cell — column labels must be this span. */}
                          <span className="sd-matrix__responsive-title">
                            {col.text}
                          </span>
                        </label>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </fieldset>
    </div>
  );
}
