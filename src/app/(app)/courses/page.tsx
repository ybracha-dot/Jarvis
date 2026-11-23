"use client";
import Link from "next/link";
import { useQuery } from "@/components/api";
import { Card, Spinner, ErrorBox, SectionTitle } from "@/components/ui";
export default function CoursesPage() {
  const q = useQuery<any>("/courses");
  if (q.loading && !q.data) return <Spinner />;
  if (q.error && !q.data) return <ErrorBox error={q.error} onRetry={q.reload} />;
  return <div className="space-y-4"><h1 className="text-xl font-semibold tracking-tight">Courses</h1>
    {q.data.courses.length === 0 && <Card className="p-4 text-sm text-muted">No courses yet. Import a syllabus under Sources.</Card>}
    <ul className="grid sm:grid-cols-2 gap-3">{q.data.courses.map((c: any) => <li key={c.code}><Link href={`/courses/${c.code}`} className="block rounded-xl border border-line bg-surface hover:border-line-strong p-4"><div className="font-medium">{c.code}</div><div className="text-sm text-muted">{c.name}</div></Link></li>)}</ul></div>;
}
