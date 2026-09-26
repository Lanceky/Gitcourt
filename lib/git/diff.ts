export type DiffLineType = "context" | "addition" | "deletion";

export type DiffLine = {
  type: DiffLineType;
  value: string;
};

export type FileDiff = {
  filepath: string;
  before: string | null;
  after: string | null;
  lines: DiffLine[];
};

function lineKey(line: string): string {
  return line;
}

export function createLineDiff(
  before: string | null,
  after: string | null,
): DiffLine[] {
  const beforeLines = before === null ? [] : before.split("\n");
  const afterLines = after === null ? [] : after.split("\n");
  const rows = Array.from({ length: beforeLines.length + 1 }, () =>
    Array<number>(afterLines.length + 1).fill(0),
  );

  for (
    let beforeIndex = beforeLines.length - 1;
    beforeIndex >= 0;
    beforeIndex -= 1
  ) {
    for (
      let afterIndex = afterLines.length - 1;
      afterIndex >= 0;
      afterIndex -= 1
    ) {
      rows[beforeIndex][afterIndex] =
        lineKey(beforeLines[beforeIndex]) === lineKey(afterLines[afterIndex])
          ? rows[beforeIndex + 1][afterIndex + 1] + 1
          : Math.max(
              rows[beforeIndex + 1][afterIndex],
              rows[beforeIndex][afterIndex + 1],
            );
    }
  }

  const lines: DiffLine[] = [];
  let beforeIndex = 0;
  let afterIndex = 0;

  while (beforeIndex < beforeLines.length && afterIndex < afterLines.length) {
    if (beforeLines[beforeIndex] === afterLines[afterIndex]) {
      lines.push({ type: "context", value: beforeLines[beforeIndex] });
      beforeIndex += 1;
      afterIndex += 1;
    } else if (
      rows[beforeIndex + 1][afterIndex] >= rows[beforeIndex][afterIndex + 1]
    ) {
      lines.push({ type: "deletion", value: beforeLines[beforeIndex] });
      beforeIndex += 1;
    } else {
      lines.push({ type: "addition", value: afterLines[afterIndex] });
      afterIndex += 1;
    }
  }

  while (beforeIndex < beforeLines.length) {
    lines.push({ type: "deletion", value: beforeLines[beforeIndex] });
    beforeIndex += 1;
  }

  while (afterIndex < afterLines.length) {
    lines.push({ type: "addition", value: afterLines[afterIndex] });
    afterIndex += 1;
  }

  return lines;
}
