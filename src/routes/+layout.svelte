<script lang="ts">
  import "$lib/app.css";
  import { theme } from "$lib/stores/theme.svelte";
  let { children } = $props();

  // Apply the persisted theme as early as possible. The CSS base fallback
  // (Manuscript dark) covers first paint before this resolves.
  void theme.init();
</script>

{@render children()}
