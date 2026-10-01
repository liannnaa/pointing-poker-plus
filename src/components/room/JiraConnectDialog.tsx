"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type JiraConnectDialogProps = {
  onConnected: (info: { email: string; base_url: string }) => void;
};

export function JiraConnectDialog({ onConnected }: JiraConnectDialogProps) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [projectKey, setProjectKey] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await fetch("/api/jira/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          token,
          base_url: baseUrl,
          ...(projectKey.trim() && { project_key: projectKey.trim().toUpperCase() }),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error);
      }

      toast.success("Connected to Jira");
      setOpen(false);
      onConnected({ email: data.email, base_url: data.base_url });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to connect");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="h-7 text-xs border-border text-muted-foreground hover:text-foreground"
      >
        Connect Jira
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-card border-border sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">Connect to Jira</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Your API token is encrypted and never exposed to other participants.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <label htmlFor="jira-email" className="text-xs font-medium text-foreground">
                Email
              </label>
              <Input
                id="jira-email"
                type="email"
                placeholder="Your Jira email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="jira-token" className="text-xs font-medium text-foreground">
                API Token
              </label>
              <Input
                id="jira-token"
                type="password"
                placeholder="Your Jira API token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                required
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="jira-url" className="text-xs font-medium text-foreground">
                Jira Base URL
              </label>
              <Input
                id="jira-url"
                type="url"
                placeholder="https://company.atlassian.net"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                required
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="jira-project-key" className="text-xs font-medium text-foreground">
                Project Key{" "}
                <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <Input
                id="jira-project-key"
                type="text"
                placeholder="e.g. PROJ"
                value={projectKey}
                onChange={(e) => setProjectKey(e.target.value)}
                className="h-8 text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Limits boards and sprints to this project.
              </p>
            </div>
            <Button type="submit" disabled={loading} className="w-full h-8 text-sm">
              {loading ? "Connecting..." : "Connect"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
