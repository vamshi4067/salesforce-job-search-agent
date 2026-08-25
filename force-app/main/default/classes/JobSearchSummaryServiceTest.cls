@IsTest
private class JobSearchSummaryServiceTest {
    @IsTest static void sendsSummary() {
        RestRequest request = new RestRequest();
        request.requestURI = '/services/apexrest/job-search/v1/summary';
        request.httpMethod = 'POST';
        request.requestBody = Blob.valueOf('{"email":"test@example.com","jobs":[{"title":"Salesforce Admin","company":"Acme","score":91,"url":"https://example.com/job"}]}');
        RestContext.request = request;
        RestContext.response = new RestResponse();
        Test.startTest();
        Map<String, Object> result = JobSearchSummaryService.sendSummary();
        Test.stopTest();
        System.assertEquals(true, result.get('sent'));
        System.assertEquals(1, result.get('count'));
    }

    @IsTest static void rejectsMissingEmail() {
        RestRequest request = new RestRequest();
        request.requestBody = Blob.valueOf('{"jobs":[]}');
        RestContext.request = request;
        RestContext.response = new RestResponse();
        Map<String, Object> result = JobSearchSummaryService.sendSummary();
        System.assertEquals(false, result.get('sent'));
        System.assertEquals(400, RestContext.response.statusCode);
    }
}
