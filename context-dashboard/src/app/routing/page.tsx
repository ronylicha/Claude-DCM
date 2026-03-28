"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageContainer } from "@/components/PageContainer";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import apiClient from "@/lib/api-client";
import { PremiumKPICard } from "@/components/dashboard/PremiumKPICard";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Route,
  Search,
  Target,
  Zap,
  TrendingUp,
  MessageSquare,
  CheckCircle,
  XCircle,
  Clock,
  Hash,
  ThumbsUp,
  ThumbsDown,
} from "lucide-react";

// Types for routing
interface RoutingStatsTotals {
  total_records: number;
  unique_keywords: number;
  unique_tools: number;
  avg_score: number;
  avg_usage?: number;
}

interface RoutingTopTool {
  tool_name: string;
  tool_type: string;
  total_usage?: number;
  avg_score?: number;
}

interface RoutingTypeDistribution {
  tool_type: string;
  tool_count: number;
}

interface RoutingStats {
  totals: RoutingStatsTotals;
  top_by_usage: RoutingTopTool[];
  top_by_score: RoutingTopTool[];
  type_distribution: RoutingTypeDistribution[];
}

interface RoutingSuggestion {
  tool_name: string;
  tool_type: "agent" | "skill" | "command" | "workflow" | "plugin";
  score: number;
  usage_count: number;
  last_used?: string | null;
  keyword_matches?: string[];
}

interface RoutingSuggestResponse {
  keywords: string[];
  suggestions: RoutingSuggestion[];
  count: number;
}

interface RoutingFeedbackRequest {
  keywords: string[];
  selected_tool: string;
  suggested_tools: string[];
  accepted: boolean;
}

// API functions
async function fetchRoutingStats(): Promise<RoutingStats> {
  return apiClient.getRoutingStats();
}

async function fetchRoutingSuggestions(keywords: string): Promise<RoutingSuggestResponse> {
  const keywordList = keywords.split(/\s+/).filter(Boolean);
  const result = await apiClient.suggestRouting(keywordList);
  return {
    keywords: keywordList,
    suggestions: result.suggestions as unknown as RoutingSuggestion[],
    count: result.suggestions.length,
  };
}

async function submitFeedback(feedback: RoutingFeedbackRequest): Promise<{ success: boolean }> {
  return apiClient.submitRoutingFeedback({
    keywords: feedback.keywords,
    selected_tool: feedback.selected_tool,
    tool_type: "agent",
    was_helpful: feedback.accepted,
  });
}

// Type badge color helper
function getTypeBadgeVariant(type: string): "default" | "secondary" | "outline" | "destructive" {
  switch (type) {
    case "agent":
      return "default";
    case "skill":
      return "secondary";
    case "command":
      return "outline";
    case "workflow":
      return "default";
    case "plugin":
      return "secondary";
    default:
      return "outline";
  }
}

function getTypeColor(type: string): string {
  switch (type) {
    case "agent":
      return "bg-[var(--dcm-agent-orchestrator)]";
    case "skill":
      return "bg-[var(--dcm-zone-green)]";
    case "command":
      return "bg-[var(--md-sys-color-secondary)]";
    case "workflow":
      return "bg-[var(--dcm-zone-yellow)]";
    case "plugin":
      return "bg-[var(--md-sys-color-tertiary)]";
    default:
      return "bg-[var(--md-sys-color-outline)]";
  }
}

// Stats Cards Component
function StatsCards({ stats, isLoading }: { stats?: RoutingStats; isLoading: boolean }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 stagger-children">
      <PremiumKPICard
        title="Total Keywords"
        value={stats?.totals?.unique_keywords ?? 0}
        icon={<Hash className="h-4 w-4 text-white" />}
        iconGradient="bg-[var(--md-sys-color-primary)]"
        loading={isLoading}
      />
      <PremiumKPICard
        title="Total Tools"
        value={stats?.totals?.unique_tools ?? 0}
        icon={<Route className="h-4 w-4 text-white" />}
        iconGradient="bg-[var(--md-sys-color-secondary)]"
        loading={isLoading}
      />
      <PremiumKPICard
        title="Average Score"
        value={stats?.totals?.avg_score ? Number(stats.totals.avg_score).toFixed(2) : "N/A"}
        icon={<Target className="h-4 w-4 text-white" />}
        iconGradient="bg-[var(--md-sys-color-tertiary)]"
        loading={isLoading}
      />
      <PremiumKPICard
        title="Total Records"
        value={stats?.totals?.total_records ?? 0}
        icon={<Zap className="h-4 w-4 text-white" />}
        iconGradient="bg-[var(--dcm-zone-yellow)]"
        loading={isLoading}
      />
    </div>
  );
}

// Top Keywords Table
function TopKeywordsTable({ stats, isLoading }: { stats?: RoutingStats; isLoading: boolean }) {
  const tools = stats?.top_by_score ?? [];

  if (isLoading) {
    return (
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Hash className="h-5 w-5" />
            Top by Score
          </CardTitle>
          <CardDescription>Highest scoring tool-keyword pairs</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (tools.length === 0) {
    return (
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Hash className="h-5 w-5" />
            Top by Score
          </CardTitle>
          <CardDescription>Highest scoring tool-keyword pairs</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-8">
            No scoring data available yet. Start using the routing system to see statistics.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Hash className="h-5 w-5" />
          Top by Score
        </CardTitle>
        <CardDescription>Highest scoring tool-keyword pairs</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tool</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Score</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tools.slice(0, 10).map((tool, idx) => (
              <TableRow key={idx}>
                <TableCell className="font-medium">{tool.tool_name}</TableCell>
                <TableCell>
                  <Badge variant={getTypeBadgeVariant(tool.tool_type)} className="text-xs">
                    {tool.tool_type}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <span className={(tool.avg_score ?? 0) >= 3 ? "text-[var(--dcm-zone-green)]" : (tool.avg_score ?? 0) >= 2 ? "text-[var(--dcm-zone-yellow)]" : "text-muted-foreground"}>
                    {Number(tool.avg_score ?? 0).toFixed(2)}/5
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// Top Tools Table
function TopToolsTable({ stats, isLoading }: { stats?: RoutingStats; isLoading: boolean }) {
  const tools = stats?.top_by_usage ?? [];

  if (isLoading) {
    return (
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Top Tools by Usage
          </CardTitle>
          <CardDescription>Most frequently suggested tools</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (tools.length === 0) {
    return (
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Top Tools by Usage
          </CardTitle>
          <CardDescription>Most frequently suggested tools</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-8">
            No tool usage data available yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          Top Tools by Usage
        </CardTitle>
        <CardDescription>Most frequently suggested tools</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tool</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Usage Count</TableHead>
              <TableHead className="text-right">Avg Score</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tools.slice(0, 10).map((tool, idx) => (
              <TableRow key={idx}>
                <TableCell className="font-medium">{tool.tool_name}</TableCell>
                <TableCell>
                  <Badge variant={getTypeBadgeVariant(tool.tool_type)} className="text-xs">
                    {tool.tool_type}
                  </Badge>
                </TableCell>
                <TableCell className="text-right text-muted-foreground">{tool.total_usage ?? 0}</TableCell>
                <TableCell className="text-right">
                  <span className={(tool.avg_score ?? 0) >= 3 ? "text-[var(--dcm-zone-green)]" : (tool.avg_score ?? 0) >= 2 ? "text-[var(--dcm-zone-yellow)]" : "text-muted-foreground"}>
                    {Number(tool.avg_score ?? 0).toFixed(2)}/5
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// Routing Tester Component
function RoutingTester() {
  const [searchQuery, setSearchQuery] = useState("");
  const [lastQuery, setLastQuery] = useState("");
  const queryClient = useQueryClient();

  const { data: suggestions, isLoading, error } = useQuery<RoutingSuggestResponse>({
    queryKey: ["routing-suggest", lastQuery],
    queryFn: () => fetchRoutingSuggestions(lastQuery),
    enabled: lastQuery.length > 0,
    staleTime: 30000,
  });

  const feedbackMutation = useMutation({
    mutationFn: submitFeedback,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["routing-stats"] });
    },
  });

  const handleSearch = () => {
    if (searchQuery.trim()) {
      setLastQuery(searchQuery.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };

  const handleFeedback = (tool: string, accepted: boolean) => {
    if (!suggestions) return;

    feedbackMutation.mutate({
      keywords: suggestions.keywords,
      selected_tool: tool,
      suggested_tools: suggestions.suggestions.map(s => s.tool_name),
      accepted,
    });
  };

  return (
    <Card className="glass-card animate-fade-in">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Search className="h-5 w-5" />
          Test Routing
        </CardTitle>
        <CardDescription>
          Enter keywords to test routing suggestions
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder="Enter keywords (e.g., 'optimize performance react')"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1"
          />
          <Button onClick={handleSearch} disabled={!searchQuery.trim() || isLoading}>
            {isLoading ? (
              <Clock className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            <span className="ml-2">Search</span>
          </Button>
        </div>

        {error && (
          <div className="p-4 rounded-md bg-destructive/10 text-destructive text-sm">
            Error: {error.message}
          </div>
        )}

        {suggestions && suggestions.suggestions.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                Parsed keywords:{" "}
                {suggestions.keywords.map((kw, i) => (
                  <Badge key={i} variant="outline" className="mx-0.5">
                    {kw}
                  </Badge>
                ))}
              </span>
              <span>{suggestions.count} results</span>
            </div>

            <div className="space-y-2">
              {suggestions.suggestions.map((suggestion, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors animate-fade-in"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${getTypeColor(suggestion.tool_type)}`} />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{suggestion.tool_name}</span>
                        <Badge variant={getTypeBadgeVariant(suggestion.tool_type)} className="text-xs">
                          {suggestion.tool_type}
                        </Badge>
                      </div>
                      {(suggestion.keyword_matches?.length ?? 0) > 0 && (
                        <div className="flex gap-1 mt-1">
                          {suggestion.keyword_matches!.map((kw, i) => (
                            <Badge key={i} variant="secondary" className="text-xs">
                              {kw}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className={`text-lg font-bold ${suggestion.score >= 3 ? "text-[var(--dcm-zone-green)]" : suggestion.score >= 2 ? "text-[var(--dcm-zone-yellow)]" : "text-muted-foreground"}`}>
                        {Number(suggestion.score).toFixed(1)}/5
                      </div>
                      <div className="text-xs text-muted-foreground">score</div>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 text-[var(--dcm-zone-green)] hover:bg-[color-mix(in_srgb,var(--dcm-zone-green)_12%,transparent)]"
                        onClick={() => handleFeedback(suggestion.tool_name, true)}
                        disabled={feedbackMutation.isPending}
                        title="This suggestion is helpful"
                      >
                        <ThumbsUp className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 text-[var(--dcm-zone-red)] hover:bg-[color-mix(in_srgb,var(--dcm-zone-red)_12%,transparent)]"
                        onClick={() => handleFeedback(suggestion.tool_name, false)}
                        disabled={feedbackMutation.isPending}
                        title="This suggestion is not helpful"
                      >
                        <ThumbsDown className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {feedbackMutation.error && (
          <p className="text-[var(--dcm-zone-red)] text-[12px]">{feedbackMutation.error.message}</p>
        )}

        {suggestions && suggestions.suggestions.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>No suggestions found for these keywords.</p>
            <p className="text-sm">Try different or more specific terms.</p>
          </div>
        )}

        {!suggestions && !isLoading && lastQuery === "" && (
          <div className="text-center py-8 text-muted-foreground">
            <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>Enter keywords above to test the routing system.</p>
            <p className="text-sm">Example: &quot;create component react typescript&quot;</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Feedback Stats Card
function FeedbackStatsCard({ stats, isLoading }: { stats?: RoutingStats; isLoading: boolean }) {
  return (
    <Card className="glass-card animate-fade-in">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5" />
          Feedback Stats
        </CardTitle>
        <CardDescription>User feedback on suggestions</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-3/4" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Recent Feedback</span>
              <span className="font-bold text-lg text-muted-foreground">–</span>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-1 text-[var(--dcm-zone-green)]">
                <CheckCircle className="h-4 w-4" />
                <span>Helpful suggestions improve routing</span>
              </div>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-1 text-muted-foreground">
                <XCircle className="h-4 w-4" />
                <span>Negative feedback adjusts weights</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground pt-2 border-t">
              Your feedback helps the routing system learn and improve over time.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Main Page Component
export default function RoutingPage() {
  const { data: stats, isLoading, error } = useQuery<RoutingStats>({
    queryKey: ["routing-stats"],
    queryFn: fetchRoutingStats,
    refetchInterval: 60000, // Refresh every minute
  });

  return (
    <PageContainer
      title="Intelligent Routing"
      description="Manage keyword-to-tool mappings and routing weights"
    >
      {error && (
        <div className="p-4 mb-4 rounded-md bg-destructive/10 text-destructive">
          Failed to load routing stats: {error.message}
        </div>
      )}

      {/* Stats Cards */}
      <StatsCards stats={stats} isLoading={isLoading} />

      {/* Routing Tester */}
      <div className="mt-6">
        <RoutingTester />
      </div>

      {/* Tables Grid */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <TopKeywordsTable stats={stats} isLoading={isLoading} />
        <TopToolsTable stats={stats} isLoading={isLoading} />
      </div>

      {/* Feedback Stats */}
      <div className="mt-6">
        <FeedbackStatsCard stats={stats} isLoading={isLoading} />
      </div>
    </PageContainer>
  );
}
