//-----------------------------------------------------------------------
// Semantic Model Checklist Agent: Fabric App shell.
// The template's Fabric sign-in gate (see Root.tsx) protects this view. The checklist UI is a same-origin page
// (public/checklist/index.html) that talks to the checklist agent API configured with VITE_CHECKLIST_API_URL.
//-----------------------------------------------------------------------

import { checklistSrc } from '@/lib/checklist-src';

function App() {
  const apiBase = import.meta.env.VITE_CHECKLIST_API_URL ?? '';
  return (
    <main className="h-screen w-screen bg-white">
      <iframe
        title="Semantic Model Checklist Agent"
        src={checklistSrc(apiBase)}
        className="h-full w-full border-0"
      />
    </main>
  );
}

export default App;
