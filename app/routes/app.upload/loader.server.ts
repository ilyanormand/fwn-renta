import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../../shopify.server";
import { getAllSuppliers } from "../../utils/invoice.server";
import { transformSuppliersForSelect } from "./utils";
import type { LoaderData } from "./types";

export const loader = async ({
  request,
}: LoaderFunctionArgs): Promise<Response> => {
  await authenticate.admin(request);

  const suppliers = await getAllSuppliers();
  const selectOptions = transformSuppliersForSelect(suppliers);

  return json<LoaderData>({ suppliers: selectOptions });
};

