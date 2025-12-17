import type { SelectOption, Supplier } from "./types";

export function transformSuppliersForSelect(
  suppliers: Supplier[]
): SelectOption[] {
  return suppliers.map((supplier) => ({
    label: supplier.name,
    value: supplier.id,
  }));
}

