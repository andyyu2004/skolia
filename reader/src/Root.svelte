<script lang="ts">
  import { QueryClientProvider } from "@tanstack/svelte-query";
  import App from "./App.svelte";
  import { newQueryClient } from "./lib/queries.ts";

  const client = newQueryClient();
</script>

<QueryClientProvider {client}>
  <App />
</QueryClientProvider>
