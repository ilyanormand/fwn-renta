export interface SelectOption {
  label: string;
  value: string;
  disabled?: boolean;
}

export interface Supplier {
  id: string;
  name: string;
}

export interface LoaderData {
  suppliers: SelectOption[];
}

export interface ActionData {
  success?: boolean;
  invoiceId?: string;
  message?: string;
  error?: string;
}
