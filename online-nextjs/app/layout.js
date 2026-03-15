import "./globals.css";

export const metadata = {
  title: "YouMe Online",
  description: "Cloud-first YouMe build for Vercel (no YouTube download)",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
