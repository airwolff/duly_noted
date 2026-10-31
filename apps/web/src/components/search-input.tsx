export function SearchInput({ defaultQuery }: { defaultQuery?: string }) {
  return (
    <form action="" method="GET" role="search" className="flex gap-2">
      <input
        type="search"
        name="q"
        defaultValue={defaultQuery}
        placeholder="Try “budget”, “road paving”, or a person’s name"
        aria-label="Search query"
        className="flex-1 rounded-md border border-stone-300 bg-white px-4 py-2.5 placeholder:text-stone-400 focus:border-blue-700 focus:outline-none focus:ring-1 focus:ring-blue-700"
      />
      <button
        type="submit"
        className="rounded-md bg-blue-800 px-5 py-2.5 font-medium text-white transition hover:bg-blue-900"
      >
        Search
      </button>
    </form>
  );
}
