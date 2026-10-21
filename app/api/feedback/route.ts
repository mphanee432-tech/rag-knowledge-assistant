import { createClient } from '@/lib/supabase/server';

export const runtime = 'edge';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { interactionId, rating, issueTag, comment } = body;

    if (!interactionId || !rating) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: interactionId or rating' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (rating !== 'thumbs_up' && rating !== 'thumbs_down') {
      return new Response(
        JSON.stringify({ error: "Invalid rating value. Expected 'thumbs_up' or 'thumbs_down'" }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient();

    const feedbackPayload = {
      rating,
      issue_tag: issueTag || null,
      comment: comment || null,
      updated_at: new Date().toISOString(),
    };

    const { error: dbError } = await supabase
      .from('interactions')
      .update({ feedback: feedbackPayload })
      .eq('id', interactionId);

    if (dbError) {
      console.error('Feedback DB Update Error:', dbError);
      return new Response(JSON.stringify({ error: dbError.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true, feedback: feedbackPayload }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Feedback API Error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal Server Error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
