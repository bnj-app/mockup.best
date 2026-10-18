/*
  Photo mockup mode.
  Why use a separate ROUTE rather than page state: the 3D editor includes three.js + R3F, most of
  its bundle. A separate route avoids downloading that code in photo mode and keeps the modes'
  window-level keyboard/Escape listeners separate. Navigation still uses client-side Link without
  a full reload.
*/
import type { Metadata } from 'next';
import PhotoEditor from '@photo/Editor';

// Without its own title, this page shared the root title, making the two
// product surfaces indistinguishable in search results and browser tabs.
export const metadata: Metadata = {
  title: 'Photo Mockups — mockup.best',
  description:
    'Drop a screenshot into a hand or scene photo and export a polished product shot in seconds.',
  alternates: { canonical: '/photo/' },
  openGraph: {
    title: 'Photo Mockups — mockup.best',
    description:
      'Drop a screenshot into a hand or scene photo and export a polished product shot in seconds.',
    url: '/photo/',
  },
};

export default function PhotoPage() {
  return <PhotoEditor />;
}
