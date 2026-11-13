const toCamel = (key) => key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());

// Converts a snake_case database row to the camelCase shape used in API responses.
export const camelize = (row) =>
  row && Object.fromEntries(Object.entries(row).map(([key, value]) => [toCamel(key), value]));

export const camelizeAll = (rows) => rows.map(camelize);
