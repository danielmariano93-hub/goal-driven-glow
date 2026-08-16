import { LegalLayout, LegalSection } from "./LegalLayout";

export default function Privacidade() {
  return (
    <LegalLayout title="Política de Privacidade" updatedAt="16 de agosto de 2026">
      <p>
        Esta política explica quais dados o Meu Nino.IA coleta, por que coleta, como usa e quais são os seus direitos.
        Tratamos seus dados de acordo com a Lei Geral de Proteção de Dados (Lei 13.709/2018).
      </p>

      <LegalSection heading="1. Quem é o controlador">
        <p>
          O Meu Nino.IA é o controlador dos dados tratados no aplicativo. Para qualquer assunto relacionado a
          privacidade, escreva para <a href="mailto:contato@meunino.com.br">contato@meunino.com.br</a>.
        </p>
      </LegalSection>

      <LegalSection heading="2. Dados que coletamos">
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Cadastro:</strong> e-mail, nome de exibição e senha (armazenada de forma criptografada).</li>
          <li><strong>Dados financeiros que você registra:</strong> lançamentos, contas, cartões, faturas, dívidas, metas, investimentos, recorrências e compromissos.</li>
          <li><strong>Contexto comportamental:</strong> registros de emoção associados a gastos, quando você opta por informar.</li>
          <li><strong>Conversas com o Nino:</strong> mensagens de texto, áudios e imagens/documentos enviados para leitura, além das respostas geradas.</li>
          <li><strong>Conexão com WhatsApp:</strong> número vinculado (armazenado de forma mascarada na interface) e histórico das mensagens trocadas com o assistente.</li>
          <li><strong>Dados técnicos:</strong> registros de uso, erros e eventos de processamento necessários para operar e auditar o serviço.</li>
        </ul>
        <p>Não coletamos dados de menores de 18 anos e não pedimos credenciais de acesso ao seu banco.</p>
      </LegalSection>

      <LegalSection heading="3. Para que usamos">
        <ul className="list-disc space-y-1 pl-5">
          <li>Operar o aplicativo e apresentar sua situação financeira.</li>
          <li>Gerar análises, alertas, previsões e respostas do assistente.</li>
          <li>Enviar comunicações do assistente pelos canais que você autorizou.</li>
          <li>Prevenir fraude e abuso e manter registros de auditoria.</li>
          <li>Cumprir obrigações legais e, quando houver plano pago, processar a assinatura.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="4. Bases legais">
        <p>
          Tratamos seus dados para execução do contrato (prestação do serviço que você contratou), com base no seu
          consentimento quando ele é solicitado de forma específica (por exemplo, vincular o WhatsApp), para cumprimento
          de obrigação legal e para o legítimo interesse de segurança e prevenção a fraude.
        </p>
      </LegalSection>

      <LegalSection heading="5. Inteligência artificial">
        <p>
          Para gerar análises e respostas, trechos dos seus dados financeiros e das suas mensagens podem ser processados
          por provedores de modelos de inteligência artificial contratados por nós, sob obrigação contratual de
          confidencialidade e sem uso para treinamento de modelos. Os cálculos financeiros que sustentam as respostas são
          feitos pelo nosso próprio motor determinístico.
        </p>
      </LegalSection>

      <LegalSection heading="6. Compartilhamento">
        <p>
          Não vendemos seus dados. Compartilhamos apenas com operadores necessários para o funcionamento do serviço:
          infraestrutura de nuvem e banco de dados, provedores de modelos de inteligência artificial, provedor de
          mensageria do WhatsApp, serviço de e-mail transacional e, quando houver plano pago, as lojas de aplicativos e o
          processador de pagamento. Também podemos compartilhar dados por determinação legal ou judicial.
        </p>
      </LegalSection>

      <LegalSection heading="7. Segurança">
        <p>
          Usamos criptografia em trânsito, isolamento de dados por usuário no banco (cada pessoa só acessa as próprias
          informações), controle de acesso administrativo com registro de auditoria e encerramento automático de sessão
          por inatividade.
        </p>
      </LegalSection>

      <LegalSection heading="8. Retenção">
        <p>
          Mantemos seus dados enquanto sua conta existir. Após a exclusão da conta, os dados pessoais são removidos ou
          anonimizados, exceto o que precisarmos guardar por obrigação legal, contábil ou de defesa em processo.
        </p>
      </LegalSection>

      <LegalSection heading="9. Seus direitos">
        <p>
          Você pode confirmar a existência de tratamento, acessar, corrigir, portar, exportar e excluir seus dados, além
          de revogar consentimentos. No aplicativo, em <strong>Perfil → Meus dados</strong>, você exporta tudo em JSON e
          solicita a exclusão da conta a qualquer momento. Pedidos também podem ser feitos por e-mail.
        </p>
      </LegalSection>

      <LegalSection heading="10. Alterações">
        <p>
          Se esta política mudar de forma relevante, avisaremos no aplicativo antes de a nova versão entrar em vigor.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
