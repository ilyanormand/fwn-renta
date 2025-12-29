import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { authenticate } from "../shopify.server";
import db from "../db.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  // Save offline session token to Shop table for background jobs
  if (session && !session.isOnline) {
    try {
      await db.shop.upsert({
        where: { shop: session.shop },
        update: {
          adminAccessToken: session.accessToken,
          scopes: session.scope || "",
        },
        create: {
          id: session.id,
          shop: session.shop,
          adminAccessToken: session.accessToken || "",
          scopes: session.scope || "",
          installedAt: new Date(),
        },
      });
    } catch (error) {
      // Log error but don't fail the request
      console.error("Failed to save shop token:", error);
    }
  }

  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">
          Home
        </Link>
        <Link to="/app/upload">Upload Invoice</Link>
        <Link to="/app/history">Import History</Link>
        <Link to="/app/jobs">Background Jobs</Link>
        <Link to="/app/google-api">Google Sheets API</Link>
      </NavMenu>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs Remix to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
