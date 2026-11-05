import type { Metadata } from "next";
import { TodayList } from "./today-list";

export const metadata: Metadata = { title: "Today" };

export default function TodayPage() {
  return <TodayList />;
}
