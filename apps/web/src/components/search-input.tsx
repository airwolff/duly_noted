export function SearchInput({ defaultQuery }: { defaultQuery?: string }) {
  return (
    <form action="" method="GET" className="flex gap-2">
      <input
        type="search"
        name="q"
        defaultValue={defaultQuery}
        placeholder="Search published meetings…"
        aria-label="Search query"
        className="flex-1 rounded border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
      />
      <button
        type="submit"
        className="rounded bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800"
      >
        Search
      </button>
    </form>
  );
}
