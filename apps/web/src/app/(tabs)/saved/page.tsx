import { redirect } from "next/navigation";

/** Legacy `/saved` route redirected to live Notifications tab (`/notifications`). */
export default function SavedPage() {
  redirect("/notifications");
}
