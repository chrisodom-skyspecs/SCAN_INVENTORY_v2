/**
 * /inventory/admin — Admin section index
 *
 * Redirects to /inventory/admin/templates as the primary admin landing page.
 * Additional admin sections (users, sites, QR codes) will be linked from
 * the templates page header navigation in future ACs.
 */

import { redirect } from "next/navigation";

/**
 * AdminPage — redirects to the templates sub-route.
 */
export default function AdminPage() {
  redirect("/inventory/admin/templates");
}
