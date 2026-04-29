/**
 * UserSelector — searchable user picker.
 *
 * Queries `api.users.listUsers` and filters in-browser as the user types,
 * rendering a dropdown of matching results to select from.
 *
 * @example
 * ```tsx
 * const [recipient, setRecipient] = useState<UserSelectorValue | null>(null);
 *
 * <UserSelector
 *   id="recipientUser"
 *   value={recipient}
 *   onChange={setRecipient}
 *   placeholder="Search by name or email…"
 * />
 * ```
 */
export { UserSelector, default } from "./UserSelector";
export type { UserSelectorProps, UserSelectorValue } from "./UserSelector";
