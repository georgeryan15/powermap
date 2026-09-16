import { Button } from "@heroui/react";

export default function Playground() {
  return (
    <div className="p-4">
      <div className="bg-red-300 p-4 max-w-100">
        <div className="bg-white rounded-xl shadow-sm">
          <div className="p-4 border-b border-gray-300 flex justify-between items-center">
            <div className="flex flex-col">
              <span className="text-md text-gray-800 font-semibold">
                13332 Express Wy
              </span>
              <span className="text-sm text-gray-500">
                Los Angeles, CA 90001
              </span>
            </div>
            <Button variant="outline" size="sm">
              View Details
            </Button>
          </div>
          <div className="p-4 border-b border-gray-300 flex flex-col gap-4">
            <div className="flex gap-4">
              <div className="flex flex-col gap-1 w-1/3">
                <p className="text-xs text-gray-400">Distance</p>
                <p className="text-sm font-medium">0.5mi - 4 mins</p>
              </div>
              <div className="flex flex-col gap-1 w-1/3">
                <p className="text-xs text-gray-400">Time</p>
                <p className="text-sm font-medium">4 mins</p>
              </div>
              <div className="flex flex-col gap-1 w-1/3">
                <p className="text-xs text-gray-400">Time</p>
                <p className="text-sm font-medium">4 mins</p>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex gap-4">
                <div className="flex flex-col gap-1 w-1/3">
                  <p className="text-xs text-gray-400">Distance</p>
                  <p className="text-sm font-medium">0.5mi - 4 mins</p>
                </div>
                <div className="flex flex-col gap-1 w-1/3">
                  <p className="text-xs text-gray-400">Time</p>
                  <p className="text-sm font-medium">4 mins</p>
                </div>
                <div className="flex flex-col gap-1 w-1/3">
                  <p className="text-xs text-gray-400">Time</p>
                  <p className="text-sm font-medium">4 mins</p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="flex flex-col gap-1 w-1/3">
                  <p className="text-xs text-gray-400">Distance</p>
                  <p className="text-sm font-medium">0.5mi - 4 mins</p>
                </div>
                <div className="flex flex-col gap-1 w-1/3">
                  <p className="text-xs text-gray-400">Time</p>
                  <p className="text-sm font-medium">4 mins</p>
                </div>
                <div className="flex flex-col gap-1 w-1/3">
                  <p className="text-xs text-gray-400">Time</p>
                  <p className="text-sm font-medium">4 mins</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
