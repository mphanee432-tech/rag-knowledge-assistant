import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

interface Assertion {
  type: string;
  value?: string;
  provider?: string;
}

interface TestCase {
  description?: string;
  vars?: Record<string, any>;
  assert?: Assertion[];
}

const datasetPath = resolve(process.cwd(), 'evals/golden_dataset.json');
const rawData = readFileSync(datasetPath, 'utf-8');
const dataset: TestCase[] = JSON.parse(rawData);

let modifiedCount = 0;

const cleanedDataset = dataset.map((testCase) => {
  const desc = (testCase.description || '').toLowerCase();
  const isRefusalOrAdversarial =
    desc.includes('adversarial') ||
    desc.includes('refusal') ||
    desc.includes('injection') ||
    desc.includes('out-of-scope') ||
    desc.includes('unanswerable');

  let currentAsserts: Assertion[] = Array.isArray(testCase.assert) ? [...testCase.assert] : [];

  // 1. Remove hardcoded assertion-level model provider overrides
  currentAsserts.forEach((a) => {
    if (a.provider) {
      delete a.provider;
    }
  });

  // 2. Remove any legacy or duplicate anti-error assertions before re-adding
  currentAsserts = currentAsserts.filter((a) => {
    if (a.type === 'javascript' && typeof a.value === 'string') {
      return !a.value.includes("!output.startsWith('[Error:')");
    }
    return true;
  });

  // 3. For refusals and adversarial rows, remove [Chunk citation requirements
  if (isRefusalOrAdversarial) {
    currentAsserts = currentAsserts.filter((a) => {
      if (a.type === 'javascript' && typeof a.value === 'string') {
        return !a.value.includes('[Chunk');
      }
      return true;
    });
  } else {
    // For grounded rows, ensure [Chunk check exists
    const hasChunkCheck = currentAsserts.some(
      (a) => a.type === 'javascript' && typeof a.value === 'string' && a.value.includes('[Chunk')
    );
    if (!hasChunkCheck) {
      currentAsserts.unshift({ type: 'javascript', value: "output.includes('[Chunk')" });
    }
  }

  // 4. Prepend global anti-error guard to all rows
  currentAsserts.unshift({
    type: 'javascript',
    value: "!output.startsWith('[Error:')",
  });

  testCase.assert = currentAsserts;
  modifiedCount++;
  return testCase;
});

writeFileSync(datasetPath, JSON.stringify(cleanedDataset, null, 2), 'utf-8');
console.log(`[Eval Cleanse] Successfully fortified ${modifiedCount} test cases in evals/golden_dataset.json.`);
