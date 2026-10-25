"use client";
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
// Keep old shared preview links working through the single public example.
export function PreviewApp(_props: { view?: string; id?: string }) {
  const router = useRouter();
  useEffect(() => { router.replace('/try'); }, [router]);
  return <p>Opening the example… <Link href="/try">Open it here</Link></p>;
}
