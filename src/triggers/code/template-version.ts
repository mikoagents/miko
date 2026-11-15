/** Template releases use stable major.minor.patch versions, independently of Hub releases. */
export const TEMPLATE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

export function compareTemplateVersions(left: string, right: string): number {
  if (!TEMPLATE_VERSION_PATTERN.test(left) || !TEMPLATE_VERSION_PATTERN.test(right))
    throw new Error("Template versions must use major.minor.patch");
  const a = left.split(".").map(BigInt);
  const b = right.split(".").map(BigInt);
  for (let index = 0; index < 3; index++) {
    if (a[index]! > b[index]!) return 1;
    if (a[index]! < b[index]!) return -1;
  }
  return 0;
}
