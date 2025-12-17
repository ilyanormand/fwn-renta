import { useState, useEffect } from "react";
import type { InvoiceItem } from "../types";

interface UseInvoiceEditorProps {
  initialItems: InvoiceItem[];
  initialSupplierId: string;
  initialInvoiceDate: string;
  initialShippingFee: number;
  itemsPerPage?: number;
}

export function useInvoiceEditor({
  initialItems,
  initialSupplierId,
  initialInvoiceDate,
  initialShippingFee,
  itemsPerPage = 10,
}: UseInvoiceEditorProps) {
  const [editableItems, setEditableItems] = useState(initialItems);
  const [editableSupplier, setEditableSupplier] = useState(initialSupplierId);
  const [editableInvoiceDate, setEditableInvoiceDate] =
    useState(initialInvoiceDate);
  const [editableShippingFee, setEditableShippingFee] = useState(
    initialShippingFee.toString()
  );
  const [currentPage, setCurrentPage] = useState(1);

  // Sync local editable state with latest extracted data after revalidation
  useEffect(() => {
    setEditableItems(initialItems);
    setEditableSupplier(initialSupplierId);
    setEditableInvoiceDate(initialInvoiceDate);
    setEditableShippingFee(initialShippingFee.toString());
  }, [
    initialItems,
    initialSupplierId,
    initialInvoiceDate,
    initialShippingFee,
  ]);

  const updateItem = (itemId: string, field: string, value: string) => {
    setEditableItems((items) =>
      items.map((item) => {
        if (item.id === itemId) {
          const updatedItem = {
            ...item,
            [field]:
              field === "quantity" || field === "unitPrice"
                ? parseFloat(value) || 0
                : value,
          };
          // Recalculate total when quantity or unitPrice changes
          if (field === "quantity" || field === "unitPrice") {
            updatedItem.total = updatedItem.quantity * updatedItem.unitPrice;
          }
          return updatedItem;
        }
        return item;
      })
    );
  };

  const addNewItem = () => {
    const newItem = {
      id: Date.now().toString(),
      sku: "",
      name: "",
      quantity: 0,
      unitPrice: 0,
      total: 0,
    };
    setEditableItems((items) => {
      const newItems = [...items, newItem];
      const newTotalPages = Math.ceil(newItems.length / itemsPerPage);
      setCurrentPage(newTotalPages);
      return newItems;
    });
  };

  const removeItem = (itemId: string) => {
    setEditableItems((items) => {
      const newItems = items.filter((item) => item.id !== itemId);
      const newTotalPages = Math.ceil(newItems.length / itemsPerPage);
      if (currentPage > newTotalPages && newTotalPages > 0) {
        setCurrentPage(newTotalPages);
      }
      return newItems;
    });
  };

  const calculateSubtotal = () => {
    return editableItems.reduce((sum, item) => sum + item.total, 0);
  };

  const calculateTotal = () => {
    return calculateSubtotal() + parseFloat(editableShippingFee || "0");
  };

  return {
    editableItems,
    editableSupplier,
    editableInvoiceDate,
    editableShippingFee,
    currentPage,
    setEditableSupplier,
    setEditableInvoiceDate,
    setEditableShippingFee,
    setCurrentPage,
    updateItem,
    addNewItem,
    removeItem,
    calculateSubtotal,
    calculateTotal,
  };
}

