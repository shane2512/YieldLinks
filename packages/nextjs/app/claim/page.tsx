import type { NextPage } from "next";
import { ClaimCard } from "~~/components/yieldlinks/ClaimCard";
import { getMetadata } from "~~/utils/scaffold-hbar/getMetadata";

export const metadata = getMetadata({
  title: "Claim your gift",
  description: "Someone sent you a gift that grows while you wait. No wallet or HBAR needed.",
});

const ClaimPage: NextPage = () => (
  <div className="grow flex justify-center px-5 py-10 sm:py-16">
    <div className="w-full max-w-xl">
      <div className="rounded-3xl border border-base-300 bg-base-100 shadow-xl p-6 sm:p-10 flex flex-col">
        <ClaimCard />
      </div>
    </div>
  </div>
);

export default ClaimPage;
