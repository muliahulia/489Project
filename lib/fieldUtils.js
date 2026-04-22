function pickFirstStringField(row, candidateColumns) {
  if (!row || !Array.isArray(candidateColumns)) {
    return '';
  }

  for (const columnName of candidateColumns) {
    const value = row[columnName];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return '';
}

function firstExistingColumn(columnSet, preferredColumns) {
  if (!columnSet || !Array.isArray(preferredColumns)) {
    return null;
  }

  for (const columnName of preferredColumns) {
    if (columnSet.has(columnName)) {
      return columnName;
    }
  }

  return null;
}

module.exports = {
  pickFirstStringField,
  firstExistingColumn,
};
