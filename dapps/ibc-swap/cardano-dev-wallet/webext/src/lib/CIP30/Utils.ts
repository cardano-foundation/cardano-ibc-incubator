import { Paginate } from ".";

/**
 * Pretty much useless client side pagination.
 * Because we have the whole thing in memory wherever we use it.
 */
function paginateClientSide<T>(x: T[], paginate?: Paginate): T[] {
  if (paginate == null) return x;
  let start = paginate.page * paginate.limit;
  let end = start + paginate.limit;
  return x.slice(start, end);
}

export { paginateClientSide };
