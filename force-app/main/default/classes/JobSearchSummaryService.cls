@RestResource(urlMapping='/job-search/v1/summary')
global with sharing class JobSearchSummaryService {
    global class JobItem {
        public String title;
        public String company;
        public Integer score;
        public String url;
    }
    global class SummaryRequest {
        public String email;
        public List<JobItem> jobs;
    }

    @HttpPost
    global static void sendSummary() {
        SummaryRequest requestBody = (SummaryRequest) JSON.deserialize(RestContext.request.requestBody.toString(), SummaryRequest.class);
        if (requestBody == null || String.isBlank(requestBody.email)) {
            RestContext.response.statusCode = 400;
            writeResponse(new Map<String, Object>{ 'sent' => false, 'message' => 'Summary email is required.' });
            return;
        }
        List<JobItem> jobs = requestBody.jobs == null ? new List<JobItem>() : requestBody.jobs;
        String html = '<h2>Salesforce job search summary</h2><p>' + jobs.size() + ' verified matches were added or refreshed.</p><ol>';
        for (JobItem item : jobs) {
            html += '<li><strong>' + esc(item.title) + '</strong> at ' + esc(item.company) +
                ' — score ' + String.valueOf(item.score) + '/100 — <a href="' + esc(item.url) + '">view posting</a></li>';
        }
        html += '</ol><p>Open the Job Search Tracker in Salesforce to review details and attached resumes.</p>';
        Messaging.SingleEmailMessage message = new Messaging.SingleEmailMessage();
        message.setToAddresses(new List<String>{ requestBody.email });
        message.setSubject('Salesforce job matches: ' + jobs.size() + ' verified roles');
        message.setHtmlBody(html);
        Messaging.SendEmailResult[] results = Messaging.sendEmail(new List<Messaging.SingleEmailMessage>{ message });
        Boolean sent = !results.isEmpty() && results[0].isSuccess();
        writeResponse(new Map<String, Object>{ 'sent' => sent, 'count' => jobs.size() });
    }

    private static void writeResponse(Map<String, Object> payload) {
        RestContext.response.addHeader('Content-Type', 'application/json');
        RestContext.response.responseBody = Blob.valueOf(JSON.serialize(payload));
    }

    private static String esc(String value) {
        if (value == null) return '';
        return value.escapeHtml4();
    }
}
