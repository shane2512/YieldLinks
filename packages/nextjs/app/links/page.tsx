import type { NextPage } from "next";
import { MyLinks } from "~~/components/yieldlinks/MyLinks";
import { getMetadata } from "~~/utils/scaffold-hbar/getMetadata";

export const metadata = getMetadata({
  title: "My links",
  description: "Gift links created in this browser, with live value and refunds.",
});

const LinksPage: NextPage = () => (
  <div className="grow flex justify-center px-5 py-10 sm:py-16">
    <div className="w-full max-w-2xl">
      <h1 className="text-3xl font-bold mb-2">My links</h1>
      <p className="text-base-content/70 mb-6">
        Links created in this browser. Cancel an open link at any time, or refund it once it expires.
      </p>
      <MyLinks />
    </div>
  </div>
);

export default LinksPage;
