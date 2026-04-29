/**
 * SiteSelector — searchable site picker.
 *
 * Subscribes to `api.sites.listSites` (Convex real-time) and filters
 * in-browser as the user types, rendering a keyboard-navigable dropdown.
 *
 * "Sites" are deployment missions — physical locations where inspection
 * cases are deployed.  The `siteId` is the Convex missions document ID.
 *
 * @example
 * ```tsx
 * const [site, setSite] = useState<SiteSelectorValue | null>(null);
 *
 * <SiteSelector
 *   id="deploymentSite"
 *   value={site}
 *   onSelect={setSite}
 *   statusFilter="active"
 *   placeholder="Search deployment sites…"
 * />
 * ```
 */
export { SiteSelector, default } from "./SiteSelector";
export type { SiteSelectorProps, SiteSelectorValue } from "./SiteSelector";
