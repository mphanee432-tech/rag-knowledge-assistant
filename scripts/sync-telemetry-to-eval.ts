import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

// Load credentials
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: Missing Supabase credentials in environment.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function syncTelemetry() {
  console.log('Fetching negative telemetry from Supabase interactions table...');

  const { data: negativeLogs, error } = await supabase
    .from('interactions')
    .select('*')
    .eq('feedback->>rating', 'thumbs_down')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('Failed to query interactions:', error.message);
    process.exit(1);
  }

  if (!negativeLogs || negativeLogs.length === 0) {
    console.log('No negative telemetry (thumbs_down) found in database. Exiting.');
    return;
  }

  console.log(`Found ${negativeLogs.length} thumbs_down interactions.`);

  const evalPath = path.join(process.cwd(), 'evals', 'golden_dataset.json');
  if (!fs.existsSync(evalPath)) {
    console.error(`Error: Golden dataset not found at ${evalPath}`);
    process.exit(1);
  }

  const rawData = fs.readFileSync(evalPath, 'utf8');
  let dataset: any[] = JSON.parse(rawData);

  let newRowsAdded = 0;

  for (const log of negativeLogs) {
    const query = log.query_text;
    const projectId = log.project_id;
    const issueTag = log.feedback?.issue_tag || 'Telemetry Reported Failure';

    // Avoid duplicate test insertions
    const exists = dataset.some(
      (test) => test.vars?.query === query && test.vars?.projectId === projectId
    );

    if (!exists && query && projectId) {
      dataset.push({
        description: `[Telemetry Flywheel] ${issueTag}: ${query.slice(0, 50)}...`,
        vars: {
          projectId: projectId,
          query: query,
        },
        assert: [
          {
            type: 'javascript',
            value: "output.includes('[Chunk')",
          },
          {
            type: 'javascript',
            value: 'output.length <= 3000',
          },
          {
            type: 'llm-rubric',
            value: `The response must address the user query without hallucination and ground claims in the provided chunks. Issue previously reported: ${issueTag}`,
          },
        ],
      });
      newRowsAdded++;
    }
  }

  if (newRowsAdded > 0) {
    fs.writeFileSync(evalPath, JSON.stringify(dataset, null, 2), 'utf8');
    console.log(`Successfully appended ${newRowsAdded} new regression rows to evals/golden_dataset.json!`);
  } else {
    console.log('All thumbs_down interactions are already present in the evaluation dataset.');
  }
}

syncTelemetry().catch(console.error);
