# claude-proxy Edge Function

A Supabase Edge Function (Deno) that proxies requests from the admin UI to the Anthropic API. The Anthropic API key never reaches the browser.

## Deploy

```bash
# Install Supabase CLI if not already
npm install -g supabase

# Login
supabase login

# Link to your project (project ref is in the dashboard URL)
supabase link --project-ref <your-project-ref>

# Deploy
supabase functions deploy claude-proxy
```

The function automatically receives `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` from the Supabase environment — no extra setup needed.

## Test from the browser console

After logging into the admin UI:

```js
const { data: { session } } = await supabase.auth.getSession();
const res = await fetch(
  `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/claude-proxy`,
  {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Say hello in exactly 5 words.' }],
      max_tokens: 50,
    }),
  }
);
console.log(await res.json());
```

## Future endpoints

This single function handles general Claude calls. If we need specialized endpoints later (hymn auto-fill, scripture lookup, etc.), we can either:

- Add more functions (`hymn-lookup`, `scripture-lookup`)
- Or keep one function and dispatch on a `task` field in the body

For v0.1 the single proxy is enough.
