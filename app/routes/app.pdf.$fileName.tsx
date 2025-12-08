import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getPdfFile } from "../utils/fileUpload.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  
  const { fileName } = params;
  
  console.log("📄 PDF request received:", { fileName, url: request.url });
  
  if (!fileName) {
    console.error("❌ No fileName in params");
    throw new Response("File name is required", { status: 400 });
  }

  try {
    console.log("📁 Attempting to read PDF:", fileName);
    const result = await getPdfFile(fileName);
    
    console.log("📊 getPdfFile result:", { success: result.success, hasBuffer: !!result.buffer, error: result.error });
    
    if (!result.success || !result.buffer) {
      console.error("❌ PDF not found or failed to read:", result.error);
      throw new Response(result.error || "File not found", { status: 404 });
    }

    console.log("✅ PDF found, returning file");
    // Return the PDF file with appropriate headers
    return new Response(result.buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": result.size?.toString() || "",
        "Content-Disposition": `inline; filename="${decodeURIComponent(fileName)}"`,
        "Cache-Control": "private, max-age=3600", // Cache for 1 hour
      },
    });
  } catch (error) {
    console.error("❌ Error serving PDF:", error);
    throw new Response("Internal server error", { status: 500 });
  }
};
