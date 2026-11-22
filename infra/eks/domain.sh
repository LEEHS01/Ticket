#!/usr/bin/env bash
# 도메인을 ALB에 연결한다(Route 53 별칭 레코드). 호스팅 영역과 ACM 인증서는 먼저 만들어 둔다
#   aws route53 create-hosted-zone --name nyannyanpunch.cloud --caller-reference <임의 값>
#   aws acm request-certificate --domain-name nyannyanpunch.cloud --subject-alternative-names www.nyannyanpunch.cloud --validation-method DNS
#   (도메인 등록 업체에서 네임서버를 호스팅 영역의 NS 4개로 바꾸고, 검증용 CNAME을 호스팅 영역에 넣는다)
set -euo pipefail
DOMAIN=nyannyanpunch.cloud
ZONE=$(aws route53 list-hosted-zones-by-name --dns-name $DOMAIN --query 'HostedZones[0].Id' --output text)
ALB=$(kubectl get ingress ticketing -n ticketing -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
ALB_ZONE=$(aws elbv2 describe-load-balancers --query "LoadBalancers[?DNSName=='$ALB'].CanonicalHostedZoneId" --output text)

BATCH=$(cat <<JSON
{"Changes":[
 {"Action":"UPSERT","ResourceRecordSet":{"Name":"$DOMAIN","Type":"A","AliasTarget":{"HostedZoneId":"$ALB_ZONE","DNSName":"dualstack.$ALB","EvaluateTargetHealth":false}}},
 {"Action":"UPSERT","ResourceRecordSet":{"Name":"www.$DOMAIN","Type":"A","AliasTarget":{"HostedZoneId":"$ALB_ZONE","DNSName":"dualstack.$ALB","EvaluateTargetHealth":false}}}
]}
JSON
)
aws route53 change-resource-record-sets --hosted-zone-id $ZONE --change-batch "$BATCH" --query ChangeInfo.Status --output text
aws route53 list-resource-record-sets --hosted-zone-id $ZONE --query "ResourceRecordSets[?Type=='A'].[Name,AliasTarget.DNSName]" --output table
